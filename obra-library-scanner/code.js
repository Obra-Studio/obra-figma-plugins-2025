// Obra Remote Library Scanner
//
// Finds every reference to a remote (published library) resource in a Figma
// file — component instances, paint/text/effect/grid styles, and bound
// variables — and rebinds them to local equivalents so the file can be detached
// from its libraries without breaking the local component structure.
//
// ── Architecture ───────────────────────────────────────────────────────────
// The scan is deliberately split in two phases, because remote references are
// enormously repetitive: a page with 5,000 text nodes usually shares a handful
// of text styles between them.
//
//   Phase 1 (collect)  A fully SYNCHRONOUS tree walk that emits flat reference
//                      records — {nodeId, category, field, index, styleId|varId}.
//                      Zero awaits, so a page is one uninterrupted burst.
//   Phase 2 (resolve)  Dedupe those records down to unique resource ids and
//                      resolve each one EXACTLY ONCE, in Promise.all chunks with
//                      a macrotask yield between chunks.
//
// That turns an O(nodes) async cost into O(distinct references). Interleaving
// awaits into the walk — which is what this plugin used to do — is what made the
// initial scan slow.
//
// Cancellation uses a generation token, not a boolean: a boolean cannot tell
// "the user cancelled" from "a newer scan superseded this one", and a sticky
// boolean silently turns every later scan into a false "0 remote" result.

figma.skipInvisibleInstanceChildren = true;

figma.showUI(__html__, {
  width: 820,
  height: 660,
  themeColors: true,
  title: 'Obra Remote Library Scanner'
});

const DEBUG = false;
function log() {
  if (DEBUG) console.log.apply(console, arguments);
}

// ── Tuning ─────────────────────────────────────────────────────────────────

const RESOLVE_CHUNK = 100;   // unique style/variable ids resolved per batch
const INSTANCE_CHUNK = 40;   // getMainComponentAsync calls per batch
const OVERRIDE_CHUNK = 100;  // override node ids resolved per batch
const MAX_OCCURRENCES = 250;      // node rows sent to the UI per group
const MAX_GROUPS = 500;           // groups sent to the UI per report
const MAX_TOTAL_OCCURRENCES = 3000; // hard ceiling across all groups in one report

// ── Run generations (cancellation) ─────────────────────────────────────────
// Every scan and every apply claims a generation. Long loops compare their
// captured generation against the current one and bail if a newer run started.
// `cancelRun()` simply bumps it, so a cancel can never leak into the next run.

let currentGen = 0;
function beginRun() {
  // Every top-level operation starts from fresh resource metadata. These caches
  // exist to collapse thousands of duplicate lookups WITHIN one run; keeping them
  // across runs means a variable added since the last scan is reported as deleted
  // from its collection, and a style whose remote-ness changed keeps the old
  // answer. Re-resolving is O(distinct references), which is small.
  styleMetaCache.clear();
  variableMetaCache.clear();
  collectionMetaCache.clear();
  return ++currentGen;
}
function isStale(gen) {
  return gen !== currentGen;
}
function cancelRun() {
  currentGen++;
}
function nextTick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ── Page loading ───────────────────────────────────────────────────────────
// Under documentAccess: dynamic-page a page's children are unavailable until the
// page is loaded. loadAllPagesAsync() loads the ENTIRE document and is the single
// most expensive call this plugin can make, so single-page work uses
// page.loadAsync() and only whole-document work pays for the full load.

let allPagesPromise = null;
function ensureAllPages() {
  if (!allPagesPromise) {
    allPagesPromise = figma.loadAllPagesAsync().catch(err => {
      allPagesPromise = null; // let a later caller retry
      throw err;
    });
  }
  return allPagesPromise;
}

const loadedPageIds = new Set();

// Pages actually scanned since the plugin opened. Only these can be skipped on a
// re-run: freshness is claimed from the nodechange watcher, and that watcher only
// exists for pages this session loaded. An index entry written in an earlier
// session — or by a teammate, since it lives on figma.root and travels with the
// file — says nothing about whether the page has changed since.
const scannedThisSession = new Set();
async function ensurePageLoaded(page) {
  if (loadedPageIds.has(page.id)) return;
  await page.loadAsync();
  loadedPageIds.add(page.id);
  watchPage(page);
}

function getAllPages() {
  return figma.root.children.filter(node => node.type === 'PAGE');
}

function findPage(pageId) {
  const page = figma.root.children.find(p => p.id === pageId && p.type === 'PAGE');
  return page || null;
}

// ── Dirty tracking ─────────────────────────────────────────────────────────
// A cached count is only trustworthy if the page hasn't changed since. There is
// no content hash in the plugin API, so we listen for nodechange on the pages we
// have loaded. `isApplying` suppresses our own writes — otherwise every fix
// would mark the page it just cleaned as stale.

let isApplying = false;
const watchedPageIds = new Set();

function watchPage(page) {
  if (watchedPageIds.has(page.id)) return;
  watchedPageIds.add(page.id);
  try {
    page.on('nodechange', () => {
      if (isApplying) return;
      noteDocumentTouched();
      markPageDirty(page.id);
    });
  } catch (e) {
    log('nodechange unavailable for page', page.name, e);
  }
}

// When a page was last marked dirty, so a scan that started BEFORE that edit
// does not overwrite the flag with dirty:false and present pre-edit results as
// current.
const dirtyMarkedAt = new Map();

function markPageDirty(pageId) {
  dirtyMarkedAt.set(pageId, Date.now());
  const index = readIndex();
  const entry = index.pages[pageId];
  if (!entry || entry.dirty) return;
  entry.dirty = true;
  writeIndex(index);
  figma.ui.postMessage({ type: 'page-dirty', pageId });
}

// ── Persisted per-page index ───────────────────────────────────────────────
// Stored on figma.root so the index travels with the FILE: a teammate opening
// it sees the same counts and the same page exclusions. clientStorage would be
// per-user-per-machine, which is wrong for a file-scoped audit.
//
// The key carries a schema version. Every read goes through normalise(), so an
// older blob degrades to defaults instead of rendering wrong.

const INDEX_KEY = 'obraLibScan.index.v2';
const LEGACY_INDEX_KEY = 'scanIndex';
const IGNORED_KEY = 'ignoredPageIds';
const SETTINGS_KEY = 'obraLibScan.settings.v1';

function emptyIndex() {
  return { v: 2, pages: {} };
}

function normaliseEntry(raw, fallbackName) {
  const kinds = (raw && raw.byKind) || {};
  return {
    name: (raw && typeof raw.name === 'string') ? raw.name : (fallbackName || ''),
    remoteTotal: numOr(raw && raw.remoteTotal, numOr(raw && raw.remoteCount, 0)),
    localTotal: numOr(raw && raw.localTotal, numOr(raw && raw.localCount, 0)),
    byKind: {
      component: numOr(kinds.component, 0),
      style: numOr(kinds.style, 0),
      variable: numOr(kinds.variable, 0)
    },
    nodeCount: numOr(raw && raw.nodeCount, 0),
    scannedAt: numOr(raw && raw.scannedAt, 0),
    // Which instance-depth setting produced this count. A count taken at
    // 'shallow' is not comparable to one taken at 'deep', so changing the
    // setting has to invalidate the cache rather than silently mixing them.
    depth: typeof (raw && raw.depth) === 'string' ? raw.depth : '',
    dirty: !!(raw && raw.dirty)
  };
}

function numOr(value, fallback) {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

// Read + prune in one step. Pruning on every read is what stops dead page ids
// accumulating in the root pluginData blob forever (it has a hard size cap).
function readIndex() {
  let parsed = null;
  const raw = figma.root.getPluginData(INDEX_KEY);
  if (raw) {
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object') {
    parsed = migrateLegacyIndex();
  }

  const live = new Set(getAllPages().map(p => p.id));
  const index = emptyIndex();
  const source = (parsed && parsed.pages && typeof parsed.pages === 'object') ? parsed.pages : {};
  for (const pageId of Object.keys(source)) {
    if (!live.has(pageId)) continue; // page deleted — drop the entry
    index.pages[pageId] = normaliseEntry(source[pageId]);
  }
  return index;
}

// One-time read of the pre-v2 blob so existing files keep their counts.
function migrateLegacyIndex() {
  const raw = figma.root.getPluginData(LEGACY_INDEX_KEY);
  if (!raw) return emptyIndex();
  try {
    const legacy = JSON.parse(raw);
    if (!legacy || typeof legacy !== 'object') return emptyIndex();
    const index = emptyIndex();
    for (const pageId of Object.keys(legacy)) {
      const old = legacy[pageId];
      index.pages[pageId] = normaliseEntry({
        name: old && old.pageName,
        remoteTotal: old && old.remoteCount,
        localTotal: old && old.localCount,
        scannedAt: old && old.scannedAt,
        dirty: true // counts from the old engine under-reported; treat as stale
      });
    }
    return index;
  } catch (e) {
    return emptyIndex();
  }
}

// setPluginData is synchronous and THROWS if the blob exceeds Figma's per-key
// cap. Rather than let that surface as an exception mid-scan, fall back to a
// counts-only blob, then to dropping the index entirely.
// Set once the blob had to be stored in slim form. After that the stored bytes
// can never equal a full re-serialisation, so the open-time equality check would
// rewrite root pluginData on every launch.
let indexIsSlim = false;

function writeIndex(index) {
  const payload = { v: 2, pages: index.pages };
  try {
    figma.root.setPluginData(INDEX_KEY, JSON.stringify(payload));
    indexIsSlim = false;
    return true;
  } catch (e) {
    log('index write failed, retrying slim', e);
  }
  try {
    const slim = { v: 2, pages: {} };
    for (const pageId of Object.keys(index.pages)) {
      const entry = index.pages[pageId];
      slim.pages[pageId] = {
        name: entry.name,
        remoteTotal: entry.remoteTotal,
        localTotal: entry.localTotal,
        scannedAt: entry.scannedAt,
        dirty: entry.dirty
      };
    }
    figma.root.setPluginData(INDEX_KEY, JSON.stringify(slim));
    indexIsSlim = true;
    return true;
  } catch (e) {
    figma.ui.postMessage({
      type: 'toast',
      kind: 'error',
      message: 'Scan index too large to save on this document — counts are session-only.'
    });
    return false;
  }
}

function setIndexEntry(pageId, entry, index) {
  const target = index || readIndex();
  target.pages[pageId] = normaliseEntry(entry);
  if (!index) writeIndex(target);
  return target.pages[pageId];
}

// After a single fix we know exactly how many remote refs went away. Adjusting
// the stored count in place keeps the sidebar honest without a full rescan.
function adjustIndexRemote(pageId, deltaByKind) {
  const index = readIndex();
  const entry = index.pages[pageId];
  if (!entry) return null;
  let total = 0;
  for (const kind of ['component', 'style', 'variable']) {
    const delta = numOr(deltaByKind[kind], 0);
    entry.byKind[kind] = Math.max(0, entry.byKind[kind] - delta);
    total += delta;
  }
  entry.remoteTotal = Math.max(0, entry.remoteTotal - total);
  writeIndex(index);
  return entry;
}

function getIgnoredPageIds() {
  const raw = figma.root.getPluginData(IGNORED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch (e) {
    return [];
  }
}

function setIgnoredPageIds(ids) {
  figma.root.setPluginData(IGNORED_KEY, JSON.stringify(ids));
}

// ── Settings ───────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  // 'shallow'   — report an instance once, never look inside it
  // 'overrides' — also inspect descendants the file genuinely overrode (default)
  // 'deep'      — walk every instance descendant (slow; matches the old engine)
  depth: 'overrides',
  // Auto-apply threshold. 'strong' = exact + normalised + library-prefix-stripped.
  // 'weak' additionally accepts a matching two-segment name tail.
  // Name matches weaker than that are never auto-applied — they are listed for
  // review, because "spacing/xs" and "spacing/xl" are one edit apart.
  autoApply: 'strong',
  showLocal: false
};

function readSettings() {
  const raw = figma.root.getPluginData(SETTINGS_KEY);
  let parsed = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
  }
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  if (parsed && typeof parsed === 'object') {
    if (['shallow', 'overrides', 'deep'].indexOf(parsed.depth) !== -1) settings.depth = parsed.depth;
    if (['strong', 'weak'].indexOf(parsed.autoApply) !== -1) settings.autoApply = parsed.autoApply;
    settings.showLocal = !!parsed.showLocal;
  }
  return settings;
}

function writeSettings(settings) {
  figma.root.setPluginData(SETTINGS_KEY, JSON.stringify(settings));
}

// ── Reference collection (Phase 1: synchronous) ─────────────────────────────

// boundVariables keys whose value is an array or a map rather than a single
// alias. Each has a dedicated collector, because the real binding lives on the
// paint / effect / grid object, not on the mirror array.
const VAR_CONTAINER_FIELDS = {
  fills: true, strokes: true, effects: true, layoutGrids: true,
  componentProperties: true, textRangeFills: true
};

// Text field bindings are read from the styled segments, not from
// node.boundVariables — the array form there has already lost the ranges.

const STYLE_PROPS = [
  { prop: 'fillStyleId', kind: 'fill style', setter: 'setFillStyleIdAsync' },
  { prop: 'strokeStyleId', kind: 'stroke style', setter: 'setStrokeStyleIdAsync' },
  { prop: 'effectStyleId', kind: 'effect style', setter: 'setEffectStyleIdAsync' },
  { prop: 'gridStyleId', kind: 'grid style', setter: 'setGridStyleIdAsync' }
];

// Which overridden fields can carry a remote reference. Gating on this keeps the
// override pass cheap — 'characters' and 'visible' overrides are by far the most
// common and can never introduce a library dependency on their own.
const INTERESTING_OVERRIDE_FIELDS = new Set([
  'fills', 'strokes', 'effects', 'layoutGrids',
  'fillStyleId', 'strokeStyleId', 'effectStyleId', 'gridStyleId',
  'backgroundStyleId', 'textStyleId', 'styledTextSegments',
  'componentProperties',
  // Both are VariableBindableNodeFields (typings line 5768+), so an override of
  // either can carry a remote binding — a localisation string variable, or a
  // boolean driving visibility. They are also the two most common overrides, so
  // including them costs one node lookup each; correctness wins.
  'characters', 'visible',
  'width', 'height', 'itemSpacing', 'opacity',
  'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'counterAxisSpacing',
  'strokeWeight', 'strokeTopWeight', 'strokeRightWeight',
  'strokeBottomWeight', 'strokeLeftWeight',
  // NodeChangeProperty genuinely spells the top one 'stokeTopWeight' (typings
  // line 3649). Both spellings are listed so the override pass does not miss it.
  'stokeTopWeight',
  'gridRowGap', 'gridColumnGap',
  'fontSize', 'fontName', 'lineHeight', 'letterSpacing',
  'paragraphSpacing', 'paragraphIndent'
]);

function makeSink() {
  return {
    owner: null,        // id of the main component currently being walked into
    via: null,          // id of the instance currently being walked, if any
    styleRefs: [],      // { nodeId, kind, styleId, start?, end? }
    varRefs: [],        // { nodeId, category, field, index, varId, ... }
    instances: [],      // InstanceNode
    overrideNodeIds: [], // string[] — resolved in phase 2, then re-collected
    nodeCount: 0
  };
}

function collectStyleRefs(node, sink) {
  for (const spec of STYLE_PROPS) {
    if (!(spec.prop in node)) continue;
    const id = node[spec.prop];
    if (typeof id === 'string' && id) {
      sink.styleRefs.push({ nodeId: node.id, kind: spec.kind, styleId: id, ownerComponentId: sink.owner || null, viaInstanceId: sink.via || null });
    }
  }

  if (node.type !== 'TEXT') return;

  // textStyleId and fillStyleId are mixed INDEPENDENTLY: a node can have one
  // uniform text style and paint styles that vary by character range, or the
  // reverse. Each field is therefore decided on its own.
  //
  // Uniform fields are recorded directly; only fields that are actually
  // figma.mixed are read from segments. Reading a uniform field from segments
  // as well would count one style once per range — and skipping the segment read
  // because the *other* field happened to be uniform would miss it entirely.
  const textIsMixed = typeof node.textStyleId !== 'string';
  const fillIsMixed = typeof node.fillStyleId !== 'string';

  if (!textIsMixed) {
    if (node.textStyleId) {
      sink.styleRefs.push({ nodeId: node.id, kind: 'text style', styleId: node.textStyleId, ownerComponentId: sink.owner || null, viaInstanceId: sink.via || null });
    }
  }
  // A uniform fillStyleId was already recorded by the STYLE_PROPS loop above.

  if (!textIsMixed && !fillIsMixed) return;

  // One query per field. Requesting both splits the text wherever EITHER changes,
  // which chops a single style run into fragments that each need their own write.
  const readRanges = (field, kind) => {
    try {
      for (const seg of node.getStyledTextSegments([field])) {
        if (!seg[field]) continue;
        sink.styleRefs.push({
          nodeId: node.id, kind, styleId: seg[field],
          start: seg.start, end: seg.end,
          ownerComponentId: sink.owner || null, viaInstanceId: sink.via || null
        });
      }
    } catch (e) {
      log('getStyledTextSegments failed', node.id, field, e);
    }
  };
  if (textIsMixed) readRanges('textStyleId', 'text style');
  if (fillIsMixed) readRanges('fillStyleId', 'fill style');
}

function collectPaintVarRefs(node, prop, sink) {
  if (!(prop in node)) return;
  const paints = node[prop];
  if (!Array.isArray(paints)) return; // figma.mixed or unset
  for (let i = 0; i < paints.length; i++) {
    const paint = paints[i];
    if (!paint) continue;

    const bound = paint.boundVariables;
    if (bound) {
      for (const field of Object.keys(bound)) {
        const alias = bound[field];
        if (alias && alias.id) {
          sink.varRefs.push({
            nodeId: node.id, category: 'paint', container: prop,
            field, index: i, varId: alias.id, ownerComponentId: sink.owner || null, viaInstanceId: sink.via || null });
        }
      }
    }

    // A GradientPaint has no boundVariables of its own — the bindings live on
    // each ColorStop. Missing these means a gradient built from library colours
    // reads as clean. There is no setBoundVariableForColorStop in the API, so
    // these are reported but flagged for manual repair rather than auto-fixed.
    const stops = paint.gradientStops;
    if (Array.isArray(stops)) {
      for (let s = 0; s < stops.length; s++) {
        const stopBound = stops[s] && stops[s].boundVariables;
        if (!stopBound) continue;
        for (const field of Object.keys(stopBound)) {
          const alias = stopBound[field];
          if (alias && alias.id) {
            sink.varRefs.push({
              nodeId: node.id, category: 'gradientStop', container: prop,
              field, index: i, stopIndex: s, varId: alias.id, manualOnly: true, ownerComponentId: sink.owner || null, viaInstanceId: sink.via || null });
          }
        }
      }
    }
  }
}

function collectListVarRefs(node, prop, category, sink) {
  if (!(prop in node)) return;
  const list = node[prop];
  if (!Array.isArray(list)) return;
  for (let i = 0; i < list.length; i++) {
    const bound = list[i] && list[i].boundVariables;
    if (!bound) continue;
    for (const field of Object.keys(bound)) {
      const alias = bound[field];
      if (alias && alias.id) {
        sink.varRefs.push({
          nodeId: node.id, category, container: prop,
          field, index: i, varId: alias.id, ownerComponentId: sink.owner || null, viaInstanceId: sink.via || null });
      }
    }
  }
}

function collectVarRefs(node, sink) {
  const bound = node.boundVariables;
  if (bound) {
    for (const field of Object.keys(bound)) {
      if (VAR_CONTAINER_FIELDS[field]) continue;
      const value = bound[field];
      if (!value) continue;

      if (Array.isArray(value)) {
        // Text field bindings arrive here flattened into an array with the range
        // information stripped out. They are collected from the styled segments
        // instead (collectTextRangeVarRefs), where each one keeps its start/end
        // and is individually rewritable via setRangeBoundVariable.
        continue;
      }

      if (value.type === 'VARIABLE_ALIAS' && value.id) {
        sink.varRefs.push({
          nodeId: node.id, category: 'scalar', field, index: -1, varId: value.id, ownerComponentId: sink.owner || null, viaInstanceId: sink.via || null });
      }
    }

    // Component property bindings on an instance, e.g. a boolean prop driven by
    // a remote variable. Keyed by property name, not by index.
    const props = bound.componentProperties;
    if (props && typeof props === 'object') {
      for (const propName of Object.keys(props)) {
        const alias = props[propName];
        if (alias && alias.id) {
          sink.varRefs.push({
            nodeId: node.id, category: 'componentProperty',
            field: propName, index: -1, varId: alias.id, ownerComponentId: sink.owner || null, viaInstanceId: sink.via || null });
        }
      }
    }

    // textRangeFills is the same story — the per-range detail is in the segments.
  }

  collectTextRangeVarRefs(node, sink);
  collectPaintVarRefs(node, 'fills', sink);
  collectPaintVarRefs(node, 'strokes', sink);
  collectListVarRefs(node, 'effects', 'effect', sink);
  collectListVarRefs(node, 'layoutGrids', 'layoutGrid', sink);
}

// Per-range bindings on a TEXT node. Each styled segment carries at most one
// alias per field, plus its own fills, and every one of them can be rewritten
// with setRangeBoundVariable / setRangeFills. Reading node.boundVariables instead
// gives a flat array with no ranges, which is what made rich text look
// unfixable — it never was.
function collectTextRangeVarRefs(node, sink) {
  if (node.type !== 'TEXT') return;

  // A uniform fill is already recorded by collectPaintVarRefs from node.fills.
  // Only read fills from the segments when they actually vary, or the same
  // binding gets counted once per range.
  const fillsVary = !Array.isArray(node.fills);
  const owner = sink.owner || null;
  const via = sink.via || null;

  // One query per field. Segments are split wherever ANY requested field
  // changes, so asking for boundVariables and fills together fragments a single
  // binding into as many pieces as the fills happen to have — one write per
  // accidental boundary instead of one per binding, each an extra chance to fail.
  let bindingSegments = null;
  try {
    bindingSegments = node.getStyledTextSegments(['boundVariables']);
  } catch (e) {
    log('styled segment read failed', node.id, e);
    bindingSegments = null;
  }
  if (bindingSegments) {
    for (const segment of bindingSegments) {
      const bound = segment.boundVariables;
      if (!bound) continue;
      for (const field of Object.keys(bound)) {
        const alias = bound[field];
        if (alias && alias.id) {
          sink.varRefs.push({
            nodeId: node.id, category: 'textRange', field, index: -1,
            start: segment.start, end: segment.end, varId: alias.id,
            ownerComponentId: owner, viaInstanceId: via
          });
        }
      }
    }
  }

  if (!fillsVary) return;

  let fillSegments = null;
  try {
    fillSegments = node.getStyledTextSegments(['fills']);
  } catch (e) {
    log('styled fill segment read failed', node.id, e);
    return;
  }
  for (const segment of fillSegments) {
    const fills = segment.fills;
    if (!Array.isArray(fills)) continue;
    for (let i = 0; i < fills.length; i++) {
      const fillBound = fills[i] && fills[i].boundVariables;
      if (!fillBound) continue;
      for (const field of Object.keys(fillBound)) {
        const alias = fillBound[field];
        if (alias && alias.id) {
          sink.varRefs.push({
            nodeId: node.id, category: 'textRangeFill', container: 'fills',
            field, index: i, start: segment.start, end: segment.end, varId: alias.id,
            ownerComponentId: owner, viaInstanceId: via
          });
        }
      }
    }
  }
}

function collectNodeRefs(node, sink) {
  sink.nodeCount++;
  collectStyleRefs(node, sink);
  collectVarRefs(node, sink);
}

// The walk. Synchronous by design: nothing here awaits, so scanning a page is
// one uninterrupted burst rather than tens of thousands of sandbox round-trips.
function collectRefs(roots, depth) {
  const sink = makeSink();

  function visit(node, ownerId, instanceId) {
    // The OUTERMOST component wins: a variant inside a set belongs to the set,
    // because the set is what instances point at.
    const owner = ownerId || ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') ? node.id : null);
    // The OUTERMOST instance likewise: a nested instance's content still arrives
    // through the one at the top.
    const via = instanceId || (node.type === 'INSTANCE' ? node.id : null);
    sink.owner = owner;
    sink.via = via;
    collectNodeRefs(node, sink);

    if (node.type === 'INSTANCE') {
      sink.instances.push(node);
      if (depth === 'shallow') return;
      if (depth === 'overrides') {
        // Everything inside an unmodified instance is inherited from its main
        // component, so it is not independently fixable — swapping the instance
        // re-links the whole subtree. Only genuinely overridden descendants can
        // hold a reference this file owns.
        let overrides = null;
        try { overrides = node.overrides || []; } catch (e) { overrides = null; }
        if (!overrides) return;
        for (const override of overrides) {
          if (!override || override.id === node.id) continue;
          const fields = override.overriddenFields || [];
          let interesting = false;
          for (const field of fields) {
            if (INTERESTING_OVERRIDE_FIELDS.has(field)) { interesting = true; break; }
          }
          if (interesting) sink.overrideNodeIds.push({ id: override.id, viaInstanceId: node.id });
        }
        return;
      }
      // depth === 'deep' falls through and walks the whole subtree.
    }

    if ('children' in node) {
      const children = node.children;
      for (let i = 0; i < children.length; i++) visit(children[i], owner, via);
    }
  }

  for (const root of roots) visit(root, null, null);
  sink.owner = null;
  sink.via = null;
  return sink;
}

// ── Phase 2: chunked, deduped resolution ───────────────────────────────────

async function resolveUnique(ids, gen, resolveOne, onProgress) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += RESOLVE_CHUNK) {
    if (isStale(gen)) return null;
    const batch = ids.slice(i, i + RESOLVE_CHUNK);
    await Promise.all(batch.map(id =>
      resolveOne(id).then(value => { out.set(id, value); }).catch(() => { out.set(id, null); })
    ));
    if (onProgress) onProgress(Math.min(i + RESOLVE_CHUNK, ids.length), ids.length);
    if (i + RESOLVE_CHUNK < ids.length) await nextTick();
  }
  return out;
}

function uniqueIds(records, key) {
  const seen = new Set();
  const ids = [];
  for (const record of records) {
    const id = record[key];
    if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

const styleMetaCache = new Map();    // styleId → { name, type, remote } | null
const variableMetaCache = new Map(); // varId → meta | null
const collectionMetaCache = new Map();

async function resolveStyleMeta(styleId) {
  if (styleMetaCache.has(styleId)) return styleMetaCache.get(styleId);
  let meta = null;
  try {
    const style = await figma.getStyleByIdAsync(styleId);
    // A style id that resolves to nothing is a broken reference, not a clean
    // one — the old engine's `style && style.remote` test dropped these.
    meta = style
      ? { name: style.name, type: style.type, remote: !!style.remote, missing: false }
      : { name: '(unresolvable style)', type: null, remote: false, missing: true };
  } catch (e) {
    meta = { name: '(unresolvable style)', type: null, remote: false, missing: true };
  }
  styleMetaCache.set(styleId, meta);
  return meta;
}

async function resolveCollectionMeta(collectionId) {
  if (!collectionId) return null;
  if (collectionMetaCache.has(collectionId)) return collectionMetaCache.get(collectionId);
  let meta = null;
  try {
    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (collection) {
      meta = {
        name: collection.name,
        key: collection.key,
        remote: !!collection.remote,
        variableIds: collection.variableIds || null
      };
    }
  } catch (e) {
    meta = null;
  }
  collectionMetaCache.set(collectionId, meta);
  return meta;
}

async function resolveVariableMeta(varId) {
  if (variableMetaCache.has(varId)) return variableMetaCache.get(varId);
  let meta = null;
  try {
    const variable = await figma.variables.getVariableByIdAsync(varId);
    if (!variable) {
      meta = { name: '(unresolvable variable)', remote: false, missing: true };
    } else {
      const collection = await resolveCollectionMeta(variable.variableCollectionId);
      // A variable can still resolve by id after being deleted from its
      // collection — Figma shows that as a raw value. Treat it as broken.
      const orphaned = !!(collection && collection.variableIds &&
        collection.variableIds.indexOf(varId) === -1);
      meta = {
        name: variable.name,
        collectionId: variable.variableCollectionId,
        collectionName: collection ? collection.name : null,
        collectionKey: collection ? collection.key : null,
        // The collection is the more reliable signal: a variable can report
        // remote: false while living in a subscribed remote collection.
        remote: !!variable.remote || !!(collection && collection.remote),
        missing: !collection,
        orphaned
      };
    }
  } catch (e) {
    meta = { name: '(unresolvable variable)', remote: false, missing: true };
  }
  variableMetaCache.set(varId, meta);
  return meta;
}

// Real source-library names. figma.teamLibrary is the only API that exposes
// them, and only for variable collections — there is no equivalent for styles or
// components, so those fall back to a name-path heuristic.
let libraryNameByCollectionKey = null;
async function ensureLibraryNames() {
  if (libraryNameByCollectionKey) return libraryNameByCollectionKey;
  const map = new Map();
  try {
    const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    for (const collection of collections) {
      if (collection && collection.key) map.set(collection.key, collection.libraryName);
    }
  } catch (e) {
    log('teamLibrary unavailable', e);
  }
  libraryNameByCollectionKey = map;
  return map;
}

function libraryLabelFor(kind, meta, libraryNames) {
  if (kind === 'variable') {
    if (meta.collectionKey && libraryNames && libraryNames.has(meta.collectionKey)) {
      return libraryNames.get(meta.collectionKey) + ' / ' + (meta.collectionName || '');
    }
    if (meta.collectionName) return meta.collectionName;
  }
  const name = meta && meta.name;
  if (typeof name === 'string' && name.indexOf('/') !== -1) {
    const first = name.split('/')[0].trim();
    if (first) return first;
  }
  return 'Remote library';
}

// ── Local index ────────────────────────────────────────────────────────────

let localIndex = null;

// Dropped on an explicit rescan: a "no local match" result is most often followed
// by the user creating the missing local token, and reusing the old index would
// keep reporting no match.
function invalidateLocalIndex() {
  localIndex = null;
  matchCache.clear();
  libraryNameByCollectionKey = null;
}

// When the index was built, and when the document last changed under it. Creating
// the local component you are about to rebind to is the normal workflow, so an
// index built before that edit would report "no local match" for the very thing
// the user just made.
let localIndexBuiltAt = 0;
let documentTouchedAt = 0;

function noteDocumentTouched() {
  // Our own writes do not invalidate the index: a rebind changes bindings, not
  // the set of local components, styles or variables.
  if (isApplying) return;
  documentTouchedAt = Date.now();
}

async function ensureFreshLocalIndex() {
  if (localIndex && documentTouchedAt > localIndexBuiltAt) {
    invalidateLocalIndex();
  }
  return buildLocalIndex(false);
}

async function buildLocalIndex(force) {
  if (localIndex && !force) return localIndex;
  matchCache.clear(); // matches are derived from the index being rebuilt
  await ensureAllPages();

  const components = [];
  // componentId -> { pageId, pageName }. Which page a component lives on is what
  // lets a fix prefer a candidate from the page being worked on before widening
  // to the whole file.
  const componentPage = new Map();
  // normalised page name -> components on it. Design-system files routinely give
  // a component its own page named after it, which makes the page name a strong
  // identifier when the component's own name has drifted.
  const componentsByPageName = new Map();

  // Stop at COMPONENT_SET / COMPONENT / INSTANCE. Components cannot nest inside
  // components, and walking instance subtrees is the biggest pointless cost on a
  // design-system file.
  function walk(node, page) {
    const type = node.type;
    if (type === 'COMPONENT_SET') {
      if (!node.remote) {
        components.push(node);
        componentPage.set(node.id, { pageId: page.id, pageName: page.name });
        push(componentsByPageName, normaliseName(page.name), node);

        // An instance of a remote VARIANT reports its main as "Set / Variant=Value",
        // which matches no local set name. Registering each variant under that
        // same composite form gives it something exact to hit. The entry is a
        // stand-in carrying the variant's real id, so a swap lands on the variant.
        const kids = node.children || [];
        for (let v = 0; v < kids.length; v++) {
          if (kids[v].type !== 'COMPONENT') continue;
          components.push({
            id: kids[v].id,
            name: node.name + '/' + kids[v].name,
            type: 'COMPONENT',
            isVariantAlias: true
          });
          componentPage.set(kids[v].id, { pageId: page.id, pageName: page.name });
        }
      }
      return;
    }
    if (type === 'COMPONENT') {
      const insideSet = node.parent && node.parent.type === 'COMPONENT_SET';
      if (!node.remote && !insideSet) {
        components.push(node);
        componentPage.set(node.id, { pageId: page.id, pageName: page.name });
        push(componentsByPageName, normaliseName(page.name), node);
      }
      return;
    }
    if (type === 'INSTANCE') return;
    if ('children' in node) {
      const children = node.children;
      for (let i = 0; i < children.length; i++) walk(children[i], page);
    }
  }
  for (const page of figma.root.children) walk(page, page);

  // Each fetch degrades to an empty list on its own. Promise.all would otherwise
  // let one unavailable API — grid styles are the newest of these — fail the
  // whole index and with it every fix.
  const safely = (fn) => {
    try {
      const result = fn();
      return Promise.resolve(result).catch(err => { log('local index fetch failed', err); return []; });
    } catch (e) {
      log('local index fetch threw', e);
      return Promise.resolve([]);
    }
  };
  const [fillStyles, textStyles, effectStyles, gridStyles, variables] = await Promise.all([
    safely(() => figma.getLocalPaintStylesAsync()),
    safely(() => figma.getLocalTextStylesAsync()),
    safely(() => figma.getLocalEffectStylesAsync()),
    safely(() => figma.getLocalGridStylesAsync()),
    safely(() => figma.variables.getLocalVariablesAsync())
  ]);

  // Strokes consume paint styles too, so both kinds share one index.
  const paintIndex = indexByName(fillStyles);
  localIndexBuiltAt = Date.now();
  localIndex = {
    componentPage,
    componentsByPageName,
    components: indexByName(components),
    'fill style': paintIndex,
    'stroke style': paintIndex,
    'text style': indexByName(textStyles),
    'effect style': indexByName(effectStyles),
    'grid style': indexByName(gridStyles),
    variables: indexByName(variables),
    counts: {
      components: components.length,
      fillStyles: fillStyles.length,
      textStyles: textStyles.length,
      effectStyles: effectStyles.length,
      gridStyles: gridStyles.length,
      variables: variables.length
    }
  };
  return localIndex;
}

function indexByName(items) {
  const byName = new Map();
  const byNormalised = new Map();
  const byTail2 = new Map();
  const byTail1 = new Map();
  // Inverted index from name token to candidates. The fuzzy tier uses it to look
  // at plausible candidates only: without it, every unmatched group would run
  // Levenshtein against the entire local set, which on a design system with a few
  // thousand variables is millions of comparisons per scan.
  const byToken = new Map();
  for (const item of items) {
    push(byName, item.name, item);
    push(byNormalised, normaliseName(item.name), item);

    // A "Set / Variant=Value" stand-in is only ever a full-path identity. Its
    // trailing segment is a variant property — "State=Open", "Size=Large" — shared
    // by half the components in a kit, so letting it into the tail and token
    // indexes would match any component that happens to have that variant.
    if (item.isVariantAlias) continue;

    push(byTail2, tailSegments(item.name, 2), item);
    push(byTail1, tailSegments(item.name, 1), item);
    for (const token of nameTokens(item.name)) push(byToken, token, item);
  }
  return { list: items, byName, byNormalised, byTail2, byTail1, byToken };
}

// Raw, positional tokens — order and repeats preserved, because the sibling-token
// veto compares position by position.
function splitTokens(name) {
  return normaliseName(name).split(/[\/\s.]+/).filter(Boolean);
}

// Unique tokens, for the inverted index.
function nameTokens(name) {
  const unique = [];
  for (const token of splitTokens(name)) {
    if (unique.indexOf(token) === -1) unique.push(token);
  }
  return unique;
}

const FUZZY_CANDIDATE_CAP = 400;

function fuzzyCandidates(set, remoteName) {
  const tokens = nameTokens(remoteName);
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    // A scale token is shared by every sibling in a collection, so it selects
    // hundreds of candidates and none of them usefully.
    if (isScaleToken(token)) continue;
    const hits = set.byToken.get(token);
    if (!hits) continue;
    for (const item of hits) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      if (out.length >= FUZZY_CANDIDATE_CAP) return out;
    }
  }
  return out;
}

function push(map, key, value) {
  if (!key) return;
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function candidateSet(kind) {
  if (!localIndex) return null;
  if (kind === 'component') return localIndex.components;
  if (kind === 'variable') return localIndex.variables;
  return localIndex[kind] || null;
}

// ── Name matching ──────────────────────────────────────────────────────────

function normaliseName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    // A hyphen normally separates words, so it collapses to a space. But a
    // hyphen that STARTS a token and is followed by a digit is a minus sign:
    // flattening it would make 'spacing/-4' and 'spacing/4' identical, and a
    // negative spacing token is not its positive twin. Park those on \u0001,
    // collapse the rest, then restore.
    .replace(/(^|[\/ ])-(\d)/g, '$1\u0001$2')
    .replace(/[-_]/g, ' ')
    .replace(/\u0001/g, '-');
}

function segments(name) {
  return normaliseName(name).split('/').map(s => s.trim()).filter(Boolean);
}

function tailSegments(name, count) {
  const parts = segments(name);
  if (!parts.length) return '';
  return parts.slice(Math.max(0, parts.length - count)).join('/');
}

// Tokens that distinguish one design-token from its sibling. Two names that
// differ only in one of these are NOT the same token, however close their edit
// distance: "spacing/xs" → "spacing/xl" is one character, and binding one to the
// other silently changes the design.
const SCALE_TOKENS = new Set([
  'xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl', '2xl', '3xl', '4xl', '5xl', '6xl',
  'none', 'full', 'half', 'auto',
  'light', 'dark', 'lighter', 'darker',
  'default', 'hover', 'active', 'pressed', 'focus', 'disabled', 'visited',
  'primary', 'secondary', 'tertiary', 'quaternary',
  'inverse', 'inverted', 'muted', 'subtle', 'strong', 'stronger', 'weak',
  'on', 'off', 'true', 'false', 'yes', 'no',
  'start', 'end', 'top', 'bottom', 'left', 'right', 'center',
  'small', 'medium', 'large', 'huge', 'tiny',
  'thin', 'regular', 'book', 'semibold', 'bold', 'black', 'heavy',
  'success', 'warning', 'error', 'danger', 'info', 'neutral'
]);

function isScaleToken(token) {
  return SCALE_TOKENS.has(token) || /^-?\d+(\.\d+)?$/.test(token);
}

// True when the two names look like siblings in a scale rather than the same
// token spelled differently. Used to veto fuzzy matches.
function looksLikeSiblingToken(a, b) {
  // Split on slashes as well as whitespace and dots. Splitting on whitespace
  // alone leaves "spacing/xs" as a single token, which makes the whole veto
  // inert — the case this function exists to catch.
  const ta = splitTokens(a);
  const tb = splitTokens(b);
  if (ta.length !== tb.length) return false;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) continue;
    if (isScaleToken(ta[i]) || isScaleToken(tb[i])) return true;
  }
  return false;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    const swap = prev; prev = curr; curr = swap;
  }
  return prev[n];
}

function similarity(a, b) {
  const sa = normaliseName(a);
  const sb = normaliseName(b);
  if (sa === sb) return 1;
  const max = Math.max(sa.length, sb.length);
  if (!max) return 1;
  return 1 - (levenshtein(sa, sb) / max);
}

const CONFIDENCE_RANK = { exact: 4, strong: 3, weak: 2, risky: 1 };

// The same remote name recurs on every page of a file, and the answer only
// changes when the local index is rebuilt — which clears this.
const matchCache = new Map();

// `preferPageIds` narrows the search before it widens: a component sitting on the
// page being fixed beats an identically named one elsewhere in the file. It only
// breaks ties WITHIN a tier — an exact name match on another page still beats a
// partial match on this one, because the name is the stronger signal.
function matchLocal(kind, remoteName, preferPageIds) {
  const scope = (preferPageIds && preferPageIds.length) ? preferPageIds.join(',') : '';
  const cacheKey = kind + '|' + remoteName + '|' + scope;
  if (matchCache.has(cacheKey)) return matchCache.get(cacheKey);
  const result = computeMatch(kind, remoteName, preferPageIds);
  matchCache.set(cacheKey, result);
  return result;
}

// Every name a component reference could reasonably be matched on, most
// trustworthy first. A remote variant's main is reported as "Set / Variant=Value";
// the set name is the part that identifies the component, and an instance's own
// layer name defaults to that set name too.
function componentMatchNames(mainName, instanceName, mainNode) {
  const names = [];
  const add = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    // A bare variant-property string ("State=Default") identifies nothing on its
    // own and would match wildly, so it is only useful as part of a path.
    if (trimmed.indexOf('=') !== -1 && trimmed.indexOf('/') === -1) return;
    if (names.indexOf(trimmed) === -1) names.push(trimmed);
  };

  add(mainName);
  if (typeof mainName === 'string') {
    const slash = mainName.lastIndexOf('/');
    if (slash > -1) add(mainName.slice(0, slash)); // the set name
  }
  try {
    if (mainNode && mainNode.parent && mainNode.parent.type === 'COMPONENT_SET') {
      add(mainNode.parent.name);
    }
  } catch (e) { /* remote mains report no parent */ }
  add(instanceName);
  return names;
}

// Try each candidate and keep the strongest tier. Candidate order breaks ties, so
// the main's own name wins over the instance's layer name at equal confidence.
function matchComponentByNames(names, preferPageIds) {
  let best = null;
  for (const name of names) {
    const found = matchLocal('component', name, preferPageIds);
    if (!found) continue;
    if (!best || (CONFIDENCE_RANK[found.confidence] || 0) > (CONFIDENCE_RANK[best.confidence] || 0)) {
      best = found;
    }
  }
  return best;
}

function pageOfComponent(item) {
  if (!localIndex || !localIndex.componentPage) return null;
  return localIndex.componentPage.get(item.id) || null;
}

// Tiered match. Every result carries the tier that produced it so the UI can
// show it and the apply step can refuse to act on the weak ones.
function computeMatch(kind, remoteName, preferPageIds) {
  const set = candidateSet(kind);
  if (!set || !set.list.length) return null;

  const prefer = (preferPageIds && preferPageIds.length) ? new Set(preferPageIds) : null;

  const pick = (list, confidence, how) => {
    if (!list || !list.length) return null;

    // Same-page candidates first. When exactly one of several same-named
    // candidates is on the page being fixed, that also settles the ambiguity
    // that would otherwise stop the fix applying automatically.
    let chosen = list[0];
    let ambiguous = list.length > 1;
    let scoped = false;
    if (prefer && kind === 'component' && list.length) {
      const onPage = list.filter(item => {
        const page = pageOfComponent(item);
        return page && prefer.has(page.pageId);
      });
      if (onPage.length) {
        chosen = onPage[0];
        ambiguous = onPage.length > 1;
        scoped = true;
      }
    }

    const target = resolveMatchTarget(chosen);
    if (!target) return null;
    const page = kind === 'component' ? pageOfComponent(chosen) : null;
    return {
      targetId: target.id,
      targetName: chosen.name,
      targetPageName: page ? page.pageName : null,
      confidence,
      how: how + (scoped ? ', on this page' : ''),
      ambiguous
    };
  };

  let found = pick(set.byName.get(remoteName), 'exact', 'identical name');
  if (found) return found;

  const normalised = normaliseName(remoteName);
  found = pick(set.byNormalised.get(normalised), 'strong', 'same name, different casing or separators');
  if (found) return found;

  // Remote names are frequently prefixed with the library or collection, e.g.
  // "Primitives/color/red/500" against a local "color/red/500".
  //
  // The remainder must keep at least two segments. Stripping "Theme/spacing/xs"
  // down to a bare "xs" and calling that a strong match would auto-bind a
  // spacing token to whatever single-segment local happens to be called "xs" —
  // possibly a radius. A single remaining segment is only ever a 'risky' signal,
  // handled by the tail check below.
  const parts = segments(remoteName);
  for (let drop = 1; drop <= parts.length - 2; drop++) {
    const stripped = parts.slice(drop).join('/');
    found = pick(set.byNormalised.get(stripped), 'strong', 'same name without the "' + parts.slice(0, drop).join('/') + '" prefix');
    if (found) return found;
  }

  if (parts.length >= 2) {
    found = pick(set.byTail2.get(tailSegments(remoteName, 2)), 'weak', 'matching last two name segments');
    if (found) return found;
  }

  // A page named after the component. This is how a recreated component is
  // usually findable when its own layer name has drifted from the original —
  // "Backdrop (OC)" living on the page "Backdrop (OC)" but named just "Backdrop".
  if (kind === 'component' && localIndex && localIndex.componentsByPageName) {
    const onNamedPage = localIndex.componentsByPageName.get(normaliseName(remoteName));
    if (onNamedPage && onNamedPage.length) {
      const target = resolveMatchTarget(onNamedPage[0]);
      if (target) {
        return {
          targetId: target.id,
          targetName: onNamedPage[0].name,
          targetPageName: remoteName,
          confidence: 'weak',
          how: onNamedPage.length === 1
            ? 'the only component on the page named "' + remoteName + '"'
            : 'first of ' + onNamedPage.length + ' components on the page named "' + remoteName + '"',
          ambiguous: onNamedPage.length > 1
        };
      }
    }
  }

  const tail1 = tailSegments(remoteName, 1);
  const tailHits = set.byTail1.get(tail1);
  if (tailHits && tailHits.length === 1) {
    found = pick(tailHits, 'risky', 'only the final name segment matches');
    if (found) return found;
  }

  // Fuzzy, deliberately tight, restricted to candidates sharing a name token,
  // and vetoed against scale siblings.
  let best = null;
  let bestScore = 0;
  for (const candidate of fuzzyCandidates(set, remoteName)) {
    if (looksLikeSiblingToken(remoteName, candidate.name)) continue;
    const score = similarity(remoteName, candidate.name);
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  if (best && bestScore >= 0.86) {
    const target = resolveMatchTarget(best);
    if (target) {
      return {
        targetId: target.id,
        targetName: best.name,
        confidence: 'risky',
        how: 'approximate name match (' + Math.round(bestScore * 100) + '%)',
        ambiguous: false
      };
    }
  }
  return null;
}

function instanceVariantProperties(node) {
  try {
    return node.variantProperties || null;
  } catch (e) {
    return null;
  }
}

// Pick the variant of `target` whose properties match `wanted`. Exact match on
// every shared property wins; otherwise the best partial match, so a set that
// renamed one property still lands close instead of on the default.
function matchingVariant(target, wanted) {
  if (!target || target.type !== 'COMPONENT_SET' || !wanted) return null;
  const variants = (target.children || []).filter(child => child.type === 'COMPONENT');
  if (!variants.length) return null;

  const wantedKeys = Object.keys(wanted);
  if (!wantedKeys.length) return null;

  let best = null;
  let bestScore = 0;
  for (const variant of variants) {
    let props = null;
    try { props = variant.variantProperties; } catch (e) { props = null; }
    if (!props) continue;
    let score = 0;
    for (const key of wantedKeys) {
      if (props[key] !== undefined && props[key] === wanted[key]) score++;
    }
    if (score > bestScore) { bestScore = score; best = variant; }
  }
  return bestScore > 0 ? best : null;
}

// swapComponentAsync only accepts a ComponentNode, so a matched COMPONENT_SET
// has to be reduced to a variant.
// The closest local names, for when nothing matched. Bounded by the same token
// index the fuzzy tier uses, so this is cheap.
function nearMisses(kind, remoteName, limit) {
  const set = candidateSet(kind);
  if (!set || !set.list.length) return [];
  const pool = fuzzyCandidates(set, remoteName);
  const scored = (pool.length ? pool : set.list.slice(0, 200)).map(item => {
    const page = kind === 'component' ? pageOfComponent(item) : null;
    return {
      name: item.name,
      pageName: page ? page.pageName : null,
      score: Math.round(similarity(remoteName, item.name) * 100)
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit || 3);
}

function resolveMatchTarget(node) {
  if (node.type === 'COMPONENT_SET') {
    return node.defaultVariant ||
      (node.children && node.children.find(child => child.type === 'COMPONENT')) ||
      null;
  }
  return node;
}

function meetsThreshold(confidence, threshold) {
  const min = threshold === 'weak' ? CONFIDENCE_RANK.weak : CONFIDENCE_RANK.strong;
  return (CONFIDENCE_RANK[confidence] || 0) >= min;
}

// An ambiguous match means several local items share the name and the first one
// found was taken. That is a coin toss, so it never auto-applies however exact
// the name is — it goes to the review list where the user can pick deliberately.
function autoApplicable(match, threshold) {
  if (!match) return false;
  if (match.ambiguous) return false;
  return meetsThreshold(match.confidence, threshold);
}

// ── Ref store ──────────────────────────────────────────────────────────────
// Deterministic ids, so a rescan produces the same id for the same reference and
// there is no collision risk. Keyed in a Map for O(1) lookup.

const refStore = new Map();
const refIdsByScope = new Map(); // scopeKey → Set<refId>

function refIdFor(ref) {
  if (ref.category === 'component') return ref.nodeId + '#component';
  if (ref.category === 'style') {
    const range = (typeof ref.start === 'number') ? ':' + ref.start + '-' + ref.end : '';
    return ref.nodeId + '#style:' + ref.kind + range;
  }
  // The container has to be part of the id: a fills[0].color binding and a
  // strokes[0].color binding are both category 'paint', field 'color', index 0,
  // so without it they collide in refStore and one silently replaces the other —
  // making Fix write to the wrong property.
  const stop = (ref.stopIndex === undefined || ref.stopIndex === null) ? '' : ':stop' + ref.stopIndex;
  const range = (typeof ref.start === 'number') ? ':r' + ref.start + '-' + ref.end : '';
  // varId is part of the identity too: per-range text bindings all report
  // index -1 on the same field, so two ranges bound to two different variables
  // would otherwise share one id and one of them would be lost.
  return ref.nodeId + '#var:' + ref.category + ':' + (ref.container || '-') +
    ':' + ref.field + ':' + ref.index + stop + range + ':' + (ref.varId || '');
}

function refGroupKey(ref) {
  return ref.kind + '|' + ref.sourceName;
}

// Only the scope's id SET is reset. Ref ids are deterministic, so scanning a
// selection and scanning the page that contains it legitimately produce the same
// ids — deleting from refStore here would break the other scope's rows. Entries
// are overwritten on rescan, so the store stays bounded by the file's distinct
// remote references.
function clearScope(scopeKey) {
  refIdsByScope.set(scopeKey, new Set());
}

function storeRef(scopeKey, ref) {
  const refId = refIdFor(ref);
  ref.refId = refId;
  refStore.set(refId, ref);
  const set = refIdsByScope.get(scopeKey);
  if (set) set.add(refId);
  return refId;
}

// ── Progress ───────────────────────────────────────────────────────────────

function postProgress(payload) {
  payload.type = 'progress';
  figma.ui.postMessage(payload);
}

function endProgress() {
  figma.ui.postMessage({ type: 'progress-done' });
}

// ── Scanning ───────────────────────────────────────────────────────────────

// Scan one set of roots and produce a grouped report. `roots` must already be
// loaded. Returns null if a newer run superseded this one.
async function scanRoots(options) {
  const { roots, gen, scopeKey, label, depth, pageId, pageName, onPhase } = options;
  const settings = readSettings();
  const effectiveDepth = depth || settings.depth;

  const phase = (message, processed, total) => {
    if (onPhase) onPhase(message, processed, total);
    else postProgress({ message, processed: processed || 0, total: total || 0, cancellable: true });
  };

  // Yield before the synchronous walk so the label the UI just received actually
  // paints — otherwise progress always lags one step behind.
  phase('Walking ' + label + '…', 0, 0);
  await nextTick();
  if (isStale(gen)) return null;

  const sink = collectRefs(roots, effectiveDepth);

  // Overridden descendants inside instances: their ids come from
  // InstanceNode.overrides, so they have to be resolved before we can read them.
  if (sink.overrideNodeIds.length) {
    phase('Reading ' + sink.overrideNodeIds.length + ' instance override(s)…', 0, sink.overrideNodeIds.length);
    for (let i = 0; i < sink.overrideNodeIds.length; i += OVERRIDE_CHUNK) {
      if (isStale(gen)) return null;
      const batch = sink.overrideNodeIds.slice(i, i + OVERRIDE_CHUNK);
      const nodes = await Promise.all(batch.map(entry =>
        figma.getNodeByIdAsync(entry.id).catch(() => null)
      ));
      for (let n = 0; n < nodes.length; n++) {
        const node = nodes[n];
        // null happens for deleted nodes and, because
        // skipInvisibleInstanceChildren is on, for invisible instance children.
        if (node && node.type !== 'PAGE' && node.type !== 'DOCUMENT') {
          // An override belongs to this file, not to any main component — the
          // whole point is that it deviates from one — but it still arrived
          // through an instance, which is where the upstream fix lives.
          sink.owner = null;
          sink.via = batch[n].viaInstanceId;
          collectNodeRefs(node, sink);
          if (node.type === 'INSTANCE') sink.instances.push(node);
        }
      }
      phase('Reading instance overrides… ' + Math.min(i + OVERRIDE_CHUNK, sink.overrideNodeIds.length) +
        '/' + sink.overrideNodeIds.length, Math.min(i + OVERRIDE_CHUNK, sink.overrideNodeIds.length), sink.overrideNodeIds.length);
      await nextTick();
    }
  }

  const libraryNames = await ensureLibraryNames();
  if (isStale(gen)) return null;

  // Resolve unique styles.
  const styleIds = uniqueIds(sink.styleRefs, 'styleId');
  phase('Resolving ' + styleIds.length + ' style(s)…', 0, styleIds.length);
  const styleMeta = await resolveUnique(styleIds, gen, resolveStyleMeta,
    (done, total) => phase('Resolving styles… ' + done + '/' + total, done, total));
  if (!styleMeta) return null;

  // Resolve unique variables.
  const varIds = uniqueIds(sink.varRefs, 'varId');
  phase('Resolving ' + varIds.length + ' variable(s)…', 0, varIds.length);
  const varMeta = await resolveUnique(varIds, gen, resolveVariableMeta,
    (done, total) => phase('Resolving variables… ' + done + '/' + total, done, total));
  if (!varMeta) return null;

  // Resolve instance main components. This is the one lookup that cannot be
  // deduped by id — we don't know the main until we ask — so it is chunked with
  // parallelism inside each chunk.
  const instanceHits = [];
  const localInstances = [];
  // instanceId -> main component, for ANY instance, so a reference found inside
  // one can name the component it actually comes from.
  const mainByInstance = new Map();
  if (sink.instances.length) {
    phase('Checking ' + sink.instances.length + ' instance(s)…', 0, sink.instances.length);
    for (let i = 0; i < sink.instances.length; i += INSTANCE_CHUNK) {
      if (isStale(gen)) return null;
      const batch = sink.instances.slice(i, i + INSTANCE_CHUNK);
      await Promise.all(batch.map(instance =>
        instance.getMainComponentAsync().then(main => {
          if (main) mainByInstance.set(instance.id, main);
          if (!main) {
            instanceHits.push({ node: instance, main: null, broken: 'Main component not found' });
          } else if (main.removed) {
            instanceHits.push({ node: instance, main, broken: 'Main component was removed' });
          } else if (main.remote) {
            instanceHits.push({ node: instance, main, broken: null });
          } else if (main.parent === null) {
            // A healthy remote main also reports parent === null, so this branch
            // is only reachable for a non-remote main — an orphaned local ghost
            // left behind by a detach.
            instanceHits.push({ node: instance, main, broken: 'Missing variant or deleted component' });
          } else {
            localInstances.push(instance);
          }
        }).catch(() => { /* inaccessible main — skip */ })
      ));
      const done = Math.min(i + INSTANCE_CHUNK, sink.instances.length);
      phase('Checking instances… ' + done + '/' + sink.instances.length, done, sink.instances.length);
      if (done < sink.instances.length) await nextTick();
    }
  }

  // Keep only OUTERMOST offenders. Swapping the outermost instance re-links its
  // whole subtree in one operation, so swapping a nested one afterwards is
  // redundant and can clobber the variable-bound overrides the first swap
  // restored.
  const hitIds = new Set(instanceHits.map(hit => hit.node.id));
  const outermostHits = instanceHits.filter(hit => {
    let parent = hit.node.parent;
    while (parent) {
      if (hitIds.has(parent.id)) return false;
      parent = parent.parent;
    }
    return true;
  });

  if (isStale(gen)) return null;
  await ensureFreshLocalIndex();
  if (isStale(gen)) return null;

  // ── Build the report ────────────────────────────────────────────────────
  clearScope(scopeKey);

  // Where a reference actually comes from. A binding on or inside an instance is
  // inherited from that instance's main unless it was explicitly overridden, so
  // the durable fix is on the main — one edit instead of one per instance, and
  // the only place inherited content can be changed at all.
  const provenanceFor = (viaInstanceId) => {
    if (!viaInstanceId) return null;
    const main = mainByInstance.get(viaInstanceId);
    if (!main) return null;

    // A variant's own name is its property string — "Size=Default,
    // State=Hover" — which identifies nothing. The component's actual name is on
    // the set that contains it, and the set is also what a fix should target,
    // since every variant shares its content.
    let identity = main.name;
    let variantLabel = null;
    let targetId = main.id;
    try {
      if (main.parent && main.parent.type === 'COMPONENT_SET') {
        identity = main.parent.name;
        variantLabel = main.name;
        targetId = main.parent.id;
      }
    } catch (e) { /* a remote main exposes no parent */ }
    // Remote mains report the full path instead, e.g. "Button / Size=Large".
    if (variantLabel === null && typeof identity === 'string' && identity.indexOf('/') !== -1) {
      const cut = identity.lastIndexOf('/');
      const tail = identity.slice(cut + 1).trim();
      if (tail.indexOf('=') !== -1) {
        variantLabel = tail;
        identity = identity.slice(0, cut).trim();
      }
    }

    let mainPage = null;
    try {
      let p = main.parent;
      while (p && p.type !== 'PAGE') p = p.parent;
      mainPage = p && p.type === 'PAGE' ? p : null;
    } catch (e) { mainPage = null; }

    return {
      mainId: targetId,
      mainName: identity,
      variantName: variantLabel,
      mainRemote: !!main.remote,
      // A remote main cannot be edited at all; the fix there is to swap the
      // instance to a local component first.
      mainPageId: mainPage ? mainPage.id : null,
      mainPageName: mainPage ? mainPage.name : null
    };
  };

  const groups = new Map();
  const localCounts = { component: 0, style: 0, variable: 0 };
  let remoteTotal = 0;
  const issues = [];

  // Group totals stay exact whatever happens to the row budget, and "Fix N"
  // works off the group key rather than the rows, so truncating rows never
  // truncates a fix.
  let occurrenceBudget = MAX_TOTAL_OCCURRENCES;

  const addToGroup = (kind, sourceName, libraryLabel, ref, occurrence) => {
    const key = kind + '|' + sourceName;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        kind,
        sourceName,
        libraryLabel,
        total: 0,
        occurrences: [],
        truncated: false,
        match: kind === 'component'
          ? matchComponentByNames(
              (ref.nameCandidates && ref.nameCandidates.length) ? ref.nameCandidates : [sourceName],
              pageId ? [pageId] : null
            )
          : matchLocal(kind === 'variable' ? 'variable' : kind, sourceName, pageId ? [pageId] : null),
        // Tallied across every member rather than taken from whichever reference
        // created the group: one per-range text fill among forty ordinary fills
        // must not hide the bulk fix for the other forty.
        near: null,
        manualCount: 0,
        brokenCount: 0,
        namelessCount: 0,
        firstBrokenReason: null,
        manualOnly: false,
        broken: null
      };
      groups.set(key, group);
    }
    if (ref.from && ref.from.mainId) {
      group.fromMains = group.fromMains || new Map();
      if (!group.fromMains.has(ref.from.mainId)) group.fromMains.set(ref.from.mainId, { info: ref.from, count: 0 });
      group.fromMains.get(ref.from.mainId).count++;
    }
    if (ref.manualOnly) group.manualCount++;
    if (ref.nameless) group.namelessCount++;
    if (ref.broken) {
      group.brokenCount++;
      if (!group.firstBrokenReason) group.firstBrokenReason = ref.broken;
    }
    group.total++;
    if (group.occurrences.length < MAX_OCCURRENCES && occurrenceBudget > 0) {
      group.occurrences.push(occurrence);
      occurrenceBudget--;
    } else {
      group.truncated = true;
    }
  };

  for (const hit of outermostHits) {
    const name = hit.main ? hit.main.name : hit.node.name;
    const ref = {
      category: 'component',
      nodeId: hit.node.id,
      kind: 'component',
      sourceName: name,
      nameCandidates: componentMatchNames(
        hit.main ? hit.main.name : null,
        hit.node.name,
        hit.main
      ),
      pageId: pageId || null,
      pageName: pageName || null,
      broken: hit.broken,
      // Even a removed or orphaned main reports its name, and the instance's own
      // name mirrors it, so there is always something to match against.
      nameless: false
    };
    const refId = storeRef(scopeKey, ref);
    remoteTotal++;
    addToGroup('component', name, hit.broken ? 'Broken reference' : libraryLabelFor('component', { name }, libraryNames), ref, {
      refId,
      nodeId: hit.node.id,
      nodeName: hit.node.name,
      pageId: pageId || null,
      pageName: pageName || null,
      detail: hit.broken || null
    });
    if (hit.broken) issues.push({ refId, kind: 'component', name, reason: hit.broken });
  }
  localCounts.component = localInstances.length;

  for (const styleRef of sink.styleRefs) {
    const meta = styleMeta.get(styleRef.styleId);
    if (!meta) continue;
    if (!meta.remote && !meta.missing) { localCounts.style++; continue; }

    const ref = Object.assign({}, styleRef, {
      category: 'style',
      kind: styleRef.kind,
      sourceName: meta.name,
      pageId: pageId || null,
      pageName: pageName || null,
      broken: meta.missing ? 'Style id does not resolve' : null,
      // No name came back, so there is nothing to match a local style against.
      nameless: !!meta.missing,
      from: provenanceFor(styleRef.viaInstanceId)
    });
    const refId = storeRef(scopeKey, ref);
    remoteTotal++;
    const rangeNote = (typeof styleRef.start === 'number')
      ? 'characters ' + styleRef.start + '–' + styleRef.end
      : null;
    addToGroup(styleRef.kind, meta.name,
      meta.missing ? 'Broken reference' : libraryLabelFor('style', meta, libraryNames), ref, {
        refId,
        nodeId: styleRef.nodeId,
        nodeName: null, // filled in below
        pageId: pageId || null,
        pageName: pageName || null,
        detail: ref.broken || rangeNote,
        fromMainName: ref.from ? ref.from.mainName : null,
        fromMainVariant: ref.from ? ref.from.variantName : null,
        fromMainRemote: ref.from ? ref.from.mainRemote : false
      });
    if (meta.missing) issues.push({ refId, kind: styleRef.kind, name: meta.name, reason: ref.broken });
  }

  for (const varRef of sink.varRefs) {
    const meta = varMeta.get(varRef.varId);
    if (!meta) continue;
    if (!meta.remote && !meta.missing && !meta.orphaned) { localCounts.variable++; continue; }

    // Built from the collected reference rather than field by field. Listing the
    // fields by hand silently dropped start/end for per-range bindings, which
    // made setRangeBoundVariable throw on a missing "start" and made two ranges
    // on one field collapse onto a single id. The collector owns the shape.
    const ref = Object.assign({}, varRef, {
      kind: 'variable',
      sourceName: meta.name,
      manualOnly: !!varRef.manualOnly,
      pageId: pageId || null,
      pageName: pageName || null,
      broken: meta.missing ? 'Variable does not resolve'
        : meta.orphaned ? 'Deleted from its collection'
        : null,
      // An orphaned variable still reports its name, so it can be matched; a
      // variable that does not resolve at all cannot.
      nameless: !!meta.missing,
      from: provenanceFor(varRef.viaInstanceId)
    });
    const refId = storeRef(scopeKey, ref);
    remoteTotal++;
    addToGroup('variable', meta.name,
      (meta.missing || meta.orphaned) ? 'Broken reference' : libraryLabelFor('variable', meta, libraryNames), ref, {
        refId,
        nodeId: varRef.nodeId,
        nodeName: null,
        pageId: pageId || null,
        pageName: pageName || null,
        detail: ref.broken || describeBindingField(varRef)
      });
    if (ref.broken) issues.push({ refId, kind: 'variable', name: meta.name, reason: ref.broken });
  }

  // Node names are only needed for the rows we actually send, so resolve them
  // after truncation rather than for every finding.
  await fillOccurrenceNames(groups, gen);
  if (isStale(gen)) return null;

  // How many references on this page can only ever be unbound. Drives the
  // page-level "strip what cannot be rebound" action.
  let unfixableVariableCount = 0;
  for (const ref of refsForScopes([scopeKey])) {
    if (isUnfixableVariable(ref)) unfixableVariableCount++;
  }

  // Finalise the group-level flags now that every member has been counted. A
  // group is manual-only when nothing in it can be rebound automatically, and
  // broken only when every member is; a partially broken group still offers the
  // bulk fix for the members that are fine.
  for (const group of groups.values()) {
    if (!group.match && !group.manualOnly) {
      const kind = group.kind === 'component' ? 'component'
        : (group.kind === 'variable' ? 'variable' : group.kind);
      group.near = nearMisses(kind, group.sourceName, 3);
    }
    // When every occurrence traces back to one main component, that is the thing
    // to fix — say so instead of offering per-instance edits that each leave the
    // other instances untouched.
    if (group.fromMains) {
      const mains = Array.from(group.fromMains.values()).sort((a, b) => b.count - a.count);
      group.upstream = {
        mains: mains.slice(0, 3).map(m => ({
          id: m.info.mainId, name: m.info.mainName, variantName: m.info.variantName,
          remote: m.info.mainRemote, pageName: m.info.mainPageName, count: m.count
        })),
        distinct: mains.length,
        covered: mains.reduce((n, m) => n + m.count, 0),
        allFromOne: mains.length === 1 && mains[0].count === group.total,
        anyLocal: mains.some(m => !m.info.mainRemote)
      };
      delete group.fromMains;
    }

    group.manualOnly = group.manualCount === group.total;
    // `broken` describes the reference; it does NOT mean unfixable. A removed or
    // orphaned main is precisely what a same-named local component repairs.
    // Only a reference with no name left is beyond help.
    group.broken = group.brokenCount === group.total ? group.firstBrokenReason : null;
    group.unfixable = group.namelessCount === group.total;
    group.partiallyBroken = group.brokenCount > 0 && group.brokenCount < group.total;

    // Why this cannot be applied automatically, in the user's terms.
    const threshold = readSettings().autoApply;
    if (group.unfixable) {
      group.blockedReason = 'the reference no longer resolves, so there is no name left to match a local one against';
    } else if (group.manualOnly) {
      group.blockedReason = group.kind === 'variable'
        ? 'Figma exposes no setter for this kind of binding — gradient stops have to be edited on the canvas'
        : 'Figma exposes no API to rewrite this reference';
    } else if (!group.match) {
      group.blockedReason = 'no local ' + group.kind + ' has a close enough name';
    } else if (group.match.ambiguous) {
      group.blockedReason = 'several local candidates are called "' + group.match.targetName +
        '", so picking one automatically would be a coin toss';
    } else if (group.match.confidence === 'risky') {
      group.blockedReason = 'the closest local name is only an approximate match (' + group.match.how + ')';
    } else if (!meetsThreshold(group.match.confidence, threshold)) {
      group.blockedReason = 'the name matches only partially (' + group.match.how +
        ') — Settings ▸ Auto-fix safety can allow this tier, or apply it here deliberately';
    } else {
      group.blockedReason = null;
    }

    delete group.manualCount;
    delete group.brokenCount;
    delete group.namelessCount;
    delete group.firstBrokenReason;
  }

  const groupList = Array.from(groups.values())
    .sort((a, b) => {
      if (a.broken && !b.broken) return -1;
      if (!a.broken && b.broken) return 1;
      if (b.total !== a.total) return b.total - a.total;
      return a.sourceName.localeCompare(b.sourceName);
    });
  const truncatedGroups = groupList.length > MAX_GROUPS;

  const byKind = { component: 0, style: 0, variable: 0 };
  for (const group of groupList) {
    const bucket = group.kind === 'component' ? 'component'
      : group.kind === 'variable' ? 'variable' : 'style';
    byKind[bucket] += group.total;
  }

  return {
    scopeKey,
    label,
    pageId: pageId || null,
    depth: effectiveDepth,
    remoteTotal,
    byKind,
    localCounts,
    nodeCount: sink.nodeCount,
    unfixableVariableCount,
    groups: groupList.slice(0, MAX_GROUPS),
    truncatedGroups,
    groupCount: groupList.length,
    issueCount: issues.length,
    scannedAt: Date.now()
  };
}

function describeBindingField(varRef) {
  if (varRef.category === 'paint') return varRef.container + '[' + varRef.index + '] ' + varRef.field;
  if (varRef.category === 'effect') return 'effects[' + varRef.index + '] ' + varRef.field;
  if (varRef.category === 'layoutGrid') return 'layoutGrids[' + varRef.index + '] ' + varRef.field;
  if (varRef.category === 'componentProperty') return 'property "' + varRef.field + '"';
  if (varRef.category === 'textRangeFill') {
    return 'fills[' + varRef.index + '] on characters ' + varRef.start + '–' + varRef.end;
  }
  if (varRef.category === 'textRange') {
    return varRef.field + ' on characters ' + varRef.start + '–' + varRef.end;
  }
  return varRef.field;
}

async function fillOccurrenceNames(groups, gen) {
  const nodeIds = new Set();
  for (const group of groups.values()) {
    for (const occurrence of group.occurrences) {
      if (!occurrence.nodeName) nodeIds.add(occurrence.nodeId);
    }
  }
  if (!nodeIds.size) return;
  const ids = Array.from(nodeIds);
  const names = new Map();
  for (let i = 0; i < ids.length; i += OVERRIDE_CHUNK) {
    if (isStale(gen)) return;
    const batch = ids.slice(i, i + OVERRIDE_CHUNK);
    const nodes = await Promise.all(batch.map(id => figma.getNodeByIdAsync(id).catch(() => null)));
    for (let j = 0; j < batch.length; j++) {
      names.set(batch[j], nodes[j] ? nodes[j].name : '(deleted)');
    }
    if (i + OVERRIDE_CHUNK < ids.length) await nextTick();
  }
  for (const group of groups.values()) {
    for (const occurrence of group.occurrences) {
      if (!occurrence.nodeName) occurrence.nodeName = names.get(occurrence.nodeId) || '';
    }
  }
}

// ── Scan entry points ──────────────────────────────────────────────────────

const pageReports = new Map(); // pageId → report

async function scanPage(pageId, gen, progressWrap) {
  const page = findPage(pageId);
  if (!page) return null;
  const startedAt = Date.now();
  await ensurePageLoaded(page);
  if (isStale(gen)) return null;

  const report = await scanRoots({
    roots: [page],
    gen,
    scopeKey: 'page:' + pageId,
    label: page.name,
    pageId,
    pageName: page.name,
    onPhase: progressWrap
  });
  if (!report) return null;

  scannedThisSession.add(pageId);

  // If the page was edited after this scan began, the results are already behind
  // reality. Keep the dirty flag so the UI says so instead of claiming freshness.
  const markedAt = dirtyMarkedAt.get(pageId);
  report.staleOnArrival = !!(markedAt && markedAt >= startedAt);

  pageReports.set(pageId, report);
  return report;
}

function entryFromReport(report, pageName) {
  return {
    name: pageName,
    remoteTotal: report.remoteTotal,
    localTotal: report.localCounts.component + report.localCounts.style + report.localCounts.variable,
    byKind: report.byKind,
    nodeCount: report.nodeCount,
    scannedAt: report.scannedAt,
    depth: report.depth,
    dirty: !!report.staleOnArrival
  };
}

async function handleScanPage(pageId, force) {
  const gen = beginRun();
  if (force) invalidateLocalIndex();
  const page = findPage(pageId);
  if (!page) {
    endProgress();
    figma.ui.postMessage({ type: 'page-report', pageId, report: null, error: 'Page no longer exists.' });
    return;
  }

  try {
    if (!force) {
      const cached = pageReports.get(pageId);
      const entry = readIndex().pages[pageId];
      if (cached && scannedThisSession.has(pageId) && entry && !entry.dirty &&
          entry.depth === readSettings().depth) {
        figma.ui.postMessage({ type: 'page-report', pageId, report: cached, cached: true });
        return;
      }
    }

    const report = await scanPage(pageId, gen, (message, processed, total) => {
      postProgress({
        message, processed: processed || 0, total: total || 0,
        pageName: page.name, cancellable: true
      });
    });
    if (!report) {
      // Superseded by a newer run, or cancelled. Emit a terminal message anyway:
      // without one the sidebar row keeps spinning and the panel stays on
      // "Scanning…" forever.
      figma.ui.postMessage({ type: 'page-report', pageId, report: null, superseded: true });
      return;
    }
    const entry = setIndexEntry(pageId, entryFromReport(report, page.name));
    figma.ui.postMessage({ type: 'page-scanned', pageId, entry, hasRefs: true });
    figma.ui.postMessage({ type: 'page-report', pageId, report, cached: false });
  } catch (error) {
    console.error('Scan failed for page', pageId, error);
    figma.ui.postMessage({
      type: 'page-report', pageId, report: null,
      error: describeError(error)
    });
  } finally {
    endProgress();
  }
}

// Scan every non-ignored page, skipping pages whose cached count is still clean
// unless `force`. That is what makes the second run instant.
async function handleScanAll(force, onlyPageIds) {
  const gen = beginRun();
  if (force) invalidateLocalIndex();
  try {
    const settings = readSettings();
    const ignored = new Set(getIgnoredPageIds());
    const index = readIndex();
    // A caller-supplied list narrows the pass to a multi-page selection; without
    // one it is the whole file. Ignored pages are skipped either way — selecting
    // an ignored page should not quietly override the document-level exclusion.
    const only = Array.isArray(onlyPageIds) && onlyPageIds.length ? new Set(onlyPageIds) : null;
    const pages = getAllPages().filter(page =>
      !ignored.has(page.id) && (!only || only.has(page.id)));

    const queue = pages.filter(page => {
      if (force) return true;
      // Never scanned in THIS session -> scan it, whatever the stored index says.
      if (!scannedThisSession.has(page.id)) return true;
      const entry = index.pages[page.id];
      return !entry || !entry.scannedAt || entry.dirty || entry.depth !== settings.depth;
    });

    figma.ui.postMessage({
      type: 'scan-all-started',
      total: queue.length,
      skipped: pages.length - queue.length,
      pageIds: queue.map(p => p.id)
    });

    let remoteTotal = 0;
    let completed = 0;
    for (let i = 0; i < queue.length; i++) {
      if (isStale(gen)) {
        figma.ui.postMessage({ type: 'scan-cancelled', completed });
        return;
      }
      const page = queue[i];
      figma.ui.postMessage({ type: 'page-scan-started', pageId: page.id, index: i, total: queue.length });

      const report = await scanPage(page.id, gen, (message, processed, total) => {
        postProgress({
          message, processed: processed || 0, total: total || 0,
          pageName: page.name, pageIndex: i, pageCount: queue.length,
          foundSoFar: remoteTotal, cancellable: true
        });
      });
      if (!report) {
        figma.ui.postMessage({ type: 'scan-cancelled', completed });
        return;
      }

      remoteTotal += report.remoteTotal;
      completed++;
      // Write per page rather than once at the end: a cancel halfway through
      // should keep the pages that did finish.
      const entry = setIndexEntry(page.id, entryFromReport(report, page.name));
      // Counts only. The full report stays in pageReports and is handed over when
      // the user actually opens the page — posting every page's rows during a
      // whole-file scan would structure-clone tens of thousands of objects across
      // the sandbox boundary for rows nobody is looking at.
      figma.ui.postMessage({ type: 'page-scanned', pageId: page.id, entry, hasRefs: true });
    }

    figma.ui.postMessage({ type: 'scan-all-done', completed, remoteTotal });
  } catch (error) {
    console.error('Scan all failed', error);
    figma.ui.postMessage({ type: 'error', message: describeError(error) });
  } finally {
    endProgress();
  }
}

async function handleScanSelection() {
  const gen = beginRun();
  const selection = figma.currentPage.selection;
  if (!selection.length) {
    figma.ui.postMessage({ type: 'selection-report', report: null, empty: true });
    endProgress();
    return;
  }
  try {
    const report = await scanRoots({
      roots: selection.slice(),
      gen,
      scopeKey: 'selection',
      label: selection.length + ' selected layer' + (selection.length === 1 ? '' : 's'),
      pageId: figma.currentPage.id,
      pageName: figma.currentPage.name,
      onPhase: (message, processed, total) => postProgress({
        message, processed: processed || 0, total: total || 0, cancellable: true
      })
    });
    if (!report) return;
    report.selectionCount = selection.length;
    figma.ui.postMessage({ type: 'selection-report', report });
  } catch (error) {
    console.error('Selection scan failed', error);
    figma.ui.postMessage({ type: 'selection-report', report: null, error: describeError(error) });
  } finally {
    endProgress();
  }
}

// ── Document-level audit ───────────────────────────────────────────────────
// A file can have zero remote references on every page and still be tethered to
// a library: a LOCAL variable whose mode value aliases a remote variable, or a
// local style whose paint binds one. Nothing on the canvas shows this, and it is
// exactly what blocks a clean detach.

async function handleAuditDocument() {
  const gen = beginRun();
  try {
    postProgress({ message: 'Reading local variables…', processed: 0, total: 0, cancellable: true });
    await nextTick();

    const findings = [];
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const modeNames = new Map();
    for (const collection of collections) {
      for (const mode of collection.modes) modeNames.set(mode.modeId, mode.name);
    }

    const variables = await figma.variables.getLocalVariablesAsync();
    for (let i = 0; i < variables.length; i += RESOLVE_CHUNK) {
      if (isStale(gen)) return;
      const batch = variables.slice(i, i + RESOLVE_CHUNK);
      await Promise.all(batch.map(async variable => {
        const values = variable.valuesByMode || {};
        for (const modeId of Object.keys(values)) {
          const value = values[modeId];
          if (!value || value.type !== 'VARIABLE_ALIAS' || !value.id) continue;
          const meta = await resolveVariableMeta(value.id);
          if (!meta || (!meta.remote && !meta.missing)) continue;
          findings.push({
            kind: 'variable alias',
            owner: variable.name,
            ownerId: variable.id,
            detail: 'mode "' + (modeNames.get(modeId) || modeId) + '" aliases ' + meta.name,
            targetName: meta.name,
            targetId: value.id,
            broken: meta.missing ? 'target does not resolve' : null
          });
        }
      }));
      postProgress({
        message: 'Checking local variables… ' + Math.min(i + RESOLVE_CHUNK, variables.length) + '/' + variables.length,
        processed: Math.min(i + RESOLVE_CHUNK, variables.length), total: variables.length, cancellable: true
      });
      await nextTick();
    }

    postProgress({ message: 'Reading local styles…', processed: 0, total: 0, cancellable: true });
    const [paintStyles, textStyles, effectStyles, gridStyles] = await Promise.all([
      figma.getLocalPaintStylesAsync(),
      figma.getLocalTextStylesAsync(),
      figma.getLocalEffectStylesAsync(),
      figma.getLocalGridStylesAsync()
    ]);
    if (isStale(gen)) return;

    const styleGroups = [
      { label: 'paint style', styles: paintStyles },
      { label: 'text style', styles: textStyles },
      { label: 'effect style', styles: effectStyles },
      { label: 'grid style', styles: gridStyles }
    ];
    for (const group of styleGroups) {
      for (const style of group.styles) {
        const aliasIds = [];
        collectAliasIds(style.boundVariables, aliasIds);
        collectAliasIds(style.paints, aliasIds);
        collectAliasIds(style.effects, aliasIds);
        collectAliasIds(style.layoutGrids, aliasIds);
        const unique = Array.from(new Set(aliasIds));
        for (const varId of unique) {
          const meta = await resolveVariableMeta(varId);
          if (!meta || (!meta.remote && !meta.missing)) continue;
          findings.push({
            kind: group.label,
            owner: style.name,
            ownerId: style.id,
            detail: 'binds ' + meta.name,
            targetName: meta.name,
            targetId: varId,
            broken: meta.missing ? 'target does not resolve' : null
          });
        }
      }
    }
    if (isStale(gen)) return;

    await ensureFreshLocalIndex();
    for (const finding of findings) {
      finding.match = matchLocal('variable', finding.targetName);
    }

    figma.ui.postMessage({
      type: 'doc-report',
      report: {
        findings,
        total: findings.length,
        variableCount: variables.length,
        styleCount: paintStyles.length + textStyles.length + effectStyles.length + gridStyles.length,
        scannedAt: Date.now()
      }
    });
  } catch (error) {
    console.error('Document audit failed', error);
    figma.ui.postMessage({ type: 'doc-report', report: null, error: describeError(error) });
  } finally {
    endProgress();
  }
}

// Deep-walk any plain structure and collect VARIABLE_ALIAS ids. Used for style
// bindings, whose shape differs per style type and has changed between API
// versions.
function collectAliasIds(value, out, depth) {
  const level = depth || 0;
  if (!value || level > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) collectAliasIds(item, out, level + 1);
    return;
  }
  if (typeof value !== 'object') return;
  if (value.type === 'VARIABLE_ALIAS' && value.id) { out.push(value.id); return; }
  for (const key of Object.keys(value)) {
    collectAliasIds(value[key], out, level + 1);
  }
}

// ── Component impact ───────────────────────────────────────────────────────
// A remote reference inside a main component is inherited by every instance of
// it. Fixing the main is one edit that reaches all of them; fixing the instances
// is both wasted effort and usually impossible, because inherited content cannot
// be rebound on an instance at all. So the useful question is not "which page has
// the most references" but "which main components carry them, and how heavily are
// those used".

async function handleComponentImpact() {
  const gen = beginRun();
  try {
    postProgress({ message: 'Grouping references by main component…', processed: 0, total: 0, cancellable: true });
    await nextTick();

    // Every reference the session has seen, bucketed by the main it lives in.
    const byOwner = new Map();
    let orphanRefs = 0;
    for (const scopeKey of refIdsByScope.keys()) {
      if (scopeKey.indexOf('page:') !== 0) continue;
      for (const refId of refIdsByScope.get(scopeKey)) {
        const ref = refStore.get(refId);
        if (!ref) continue;
        if (!ref.ownerComponentId) { orphanRefs++; continue; }
        let entry = byOwner.get(ref.ownerComponentId);
        if (!entry) {
          entry = { ownerId: ref.ownerComponentId, refs: [], byKind: { component: 0, style: 0, variable: 0 } };
          byOwner.set(ref.ownerComponentId, entry);
        }
        entry.refs.push(ref);
        const bucket = ref.kind === 'component' ? 'component' : (ref.kind === 'variable' ? 'variable' : 'style');
        entry.byKind[bucket]++;
      }
    }

    const owners = Array.from(byOwner.values());
    const out = [];
    await ensureFreshLocalIndex();

    for (let i = 0; i < owners.length; i += INSTANCE_CHUNK) {
      if (isStale(gen)) return;
      const batch = owners.slice(i, i + INSTANCE_CHUNK);
      await Promise.all(batch.map(async entry => {
        let node = null;
        try { node = await figma.getNodeByIdAsync(entry.ownerId); } catch (e) { node = null; }
        if (!node) return;

        // getInstancesAsync lives on ComponentNode, so a set is the sum of its
        // variants. It counts instances across the whole document, which is the
        // number that matters — a component's reach is not confined to its page.
        let instanceCount = 0;
        try {
          if (node.type === 'COMPONENT_SET') {
            const variants = (node.children || []).filter(child => child.type === 'COMPONENT');
            const counts = await Promise.all(variants.map(v =>
              typeof v.getInstancesAsync === 'function'
                ? v.getInstancesAsync().then(list => list.length).catch(() => 0)
                : Promise.resolve(0)
            ));
            instanceCount = counts.reduce((a, b) => a + b, 0);
          } else if (typeof node.getInstancesAsync === 'function') {
            const list = await node.getInstancesAsync();
            instanceCount = list.length;
          }
        } catch (e) {
          instanceCount = 0;
        }

        let page = node.parent;
        while (page && page.type !== 'PAGE') page = page.parent;

        // How many of this main's references can actually be rebound right now.
        let fixable = 0;
        for (const ref of entry.refs) {
          if (ref.nameless || ref.manualOnly || ref.fixedAt) continue;
          const match = ref.kind === 'component'
            ? matchComponentByNames(
                (ref.nameCandidates && ref.nameCandidates.length) ? ref.nameCandidates : [ref.sourceName], null)
            : matchLocal(ref.kind === 'variable' ? 'variable' : ref.kind, ref.sourceName, null);
          if (match) fixable++;
        }

        out.push({
          ownerId: entry.ownerId,
          name: node.name,
          isSet: node.type === 'COMPONENT_SET',
          pageId: page ? page.id : null,
          pageName: page ? page.name : null,
          refCount: entry.refs.length,
          byKind: entry.byKind,
          instanceCount,
          fixable,
          // What fixing this main is worth: its own references, plus the same
          // references inherited by every instance that renders it.
          reach: entry.refs.length * (instanceCount + 1)
        });
      }));
      postProgress({
        message: 'Counting usage… ' + Math.min(i + INSTANCE_CHUNK, owners.length) + '/' + owners.length,
        processed: Math.min(i + INSTANCE_CHUNK, owners.length), total: owners.length, cancellable: true
      });
      await nextTick();
    }

    out.sort((a, b) => {
      if (b.reach !== a.reach) return b.reach - a.reach;
      if (b.refCount !== a.refCount) return b.refCount - a.refCount;
      return a.name.localeCompare(b.name);
    });

    const index = readIndex();
    const ignored = new Set(getIgnoredPageIds());
    const livePages = getAllPages().filter(page => !ignored.has(page.id));
    const scannedPages = livePages.filter(page => {
      const entry = index.pages[page.id];
      return entry && entry.scannedAt;
    }).length;

    figma.ui.postMessage({
      type: 'component-report',
      report: {
        components: out.slice(0, 300),
        truncated: out.length > 300,
        totalComponents: out.length,
        totalRefs: out.reduce((n, c) => n + c.refCount, 0),
        totalReach: out.reduce((n, c) => n + c.reach, 0),
        orphanRefs,
        scannedPages,
        totalPages: livePages.length,
        scannedAt: Date.now()
      }
    });
  } catch (error) {
    console.error('Component impact failed', error);
    figma.ui.postMessage({ type: 'component-report', report: null, error: describeError(error) });
  } finally {
    endProgress();
  }
}

// ── Fixing ─────────────────────────────────────────────────────────────────

// Component swaps do not reliably carry variable-bound paint/effect OVERRIDES:
// a fill overridden to `secondary` on top of a main whose default is `primary`
// reverts to the new main's default. Snapshot the genuine overrides first and
// re-apply them after the swap.
//
// Only GENUINE overrides are captured. Preserving inherited bindings would drag
// the old library's styling across the swap.
function snapshotOverrideBindings(instance) {
  const overridden = new Map();
  try {
    for (const override of (instance.overrides || [])) {
      overridden.set(override.id, new Set(override.overriddenFields || []));
    }
  } catch (e) {
    return []; // cannot tell overrides from inherited — capture nothing (safest)
  }

  const snapshot = [];
  const walk = (node, path) => {
    const fields = overridden.get(node.id);
    if (fields) {
      if (fields.has('fills')) capturePaints(node, 'fills', path, snapshot);
      if (fields.has('strokes')) capturePaints(node, 'strokes', path, snapshot);
      if (fields.has('effects')) captureList(node, 'effects', path, snapshot);
      if (fields.has('layoutGrids')) captureList(node, 'layoutGrids', path, snapshot);
    }
    if ('children' in node) {
      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        // Name AND child index. Keying on name alone puts the binding back on
        // whichever duplicate sibling comes first, which on an icon row of
        // identically-named layers is simply the wrong layer.
        walk(children[i], path.concat([{ name: children[i].name, index: i }]));
      }
    }
  };
  walk(instance, []);
  return snapshot;
}

function capturePaints(node, prop, path, snapshot) {
  if (!(prop in node)) return;
  const paints = node[prop];
  if (!Array.isArray(paints)) return;
  for (let i = 0; i < paints.length; i++) {
    const paint = paints[i];
    if (!paint) continue;

    const bound = paint.boundVariables;
    if (bound) {
      for (const field of Object.keys(bound)) {
        if (bound[field] && bound[field].id) {
          snapshot.push({ path, prop, kind: 'paint', index: i, field, varId: bound[field].id });
        }
      }
    }

    // A gradient's bindings hang off each ColorStop, not off the paint, and the
    // API has no setter for them. Recorded as unrestorable so the swap reports
    // them rather than losing them silently.
    const stops = paint.gradientStops;
    if (Array.isArray(stops)) {
      for (let stop = 0; stop < stops.length; stop++) {
        const stopBound = stops[stop] && stops[stop].boundVariables;
        if (!stopBound) continue;
        for (const field of Object.keys(stopBound)) {
          if (stopBound[field] && stopBound[field].id) {
            snapshot.push({
              path, prop, kind: 'gradientStop', index: i, stopIndex: stop,
              field, varId: stopBound[field].id, unrestorable: true
            });
          }
        }
      }
    }
  }
}

function captureList(node, prop, path, snapshot) {
  if (!(prop in node)) return;
  const list = node[prop];
  if (!Array.isArray(list)) return;
  for (let i = 0; i < list.length; i++) {
    const bound = list[i] && list[i].boundVariables;
    if (!bound) continue;
    for (const field of Object.keys(bound)) {
      if (bound[field] && bound[field].id) {
        snapshot.push({
          path, prop, kind: prop === 'effects' ? 'effect' : 'layoutGrid',
          index: i, field, varId: bound[field].id
        });
      }
    }
  }
}

function nodeAtPath(root, path) {
  let node = root;
  for (const step of path) {
    if (!('children' in node)) return null;
    const children = node.children;

    // Same position, same name — unambiguous.
    const at = children[step.index];
    if (at && at.name === step.name) { node = at; continue; }

    // The new main reordered its layers. A name lookup is only safe when the
    // name is unique among siblings; with duplicates ("Icon", "Vector",
    // "Rectangle" — routine in real components) picking the first match would
    // write the binding onto a layer the user never overrode. Give up instead.
    const matches = children.filter(child => child.name === step.name);
    if (matches.length !== 1) return null;
    node = matches[0];
  }
  return node;
}

// Applied strictly sequentially — concurrent writes to the same node's paint
// array lose updates.
async function restoreOverrideBindings(instance, snapshot) {
  let restored = 0;
  let skipped = 0;
  for (const entry of snapshot) {
    if (entry.unrestorable) { skipped++; continue; }
    const node = nodeAtPath(instance, entry.path);
    if (!node) { skipped++; continue; }
    try {
      const variable = await figma.variables.getVariableByIdAsync(entry.varId);
      if (!variable) { skipped++; continue; }
      let ok = false;
      if (entry.kind === 'paint') {
        ok = rebindPaint(node, entry.prop, entry.index, entry.field, variable);
      } else if (entry.kind === 'effect') {
        ok = rebindEffect(node, entry.index, entry.field, variable);
      } else if (entry.kind === 'layoutGrid') {
        ok = rebindLayoutGrid(node, entry.index, entry.field, variable);
      }
      // The rebind helpers return false when the index no longer exists, which
      // happens whenever the two mains have different paint or effect counts.
      // Counting that as success is how a partial restore passes for a clean one.
      if (ok) restored++; else skipped++;
    } catch (e) {
      skipped++;
      log('restore binding failed', e);
    }
  }
  return { restored, skipped };
}

// Paint / effect / grid arrays are read-only views. Clone, ask Figma for a new
// object with the binding swapped, then reassign the whole array.
function clonePlain(list) {
  return list.map(item => Object.assign({}, item));
}

function rebindPaint(node, prop, index, field, variable) {
  const paints = node[prop];
  if (!Array.isArray(paints) || index < 0 || index >= paints.length) return false;
  const copy = clonePlain(paints);
  copy[index] = figma.variables.setBoundVariableForPaint(copy[index], field || 'color', variable);
  node[prop] = copy;
  return true;
}

function rebindEffect(node, index, field, variable) {
  const effects = node.effects;
  if (!Array.isArray(effects) || index < 0 || index >= effects.length) return false;
  const copy = clonePlain(effects);
  copy[index] = figma.variables.setBoundVariableForEffect(copy[index], field, variable);
  node.effects = copy;
  return true;
}

function rebindLayoutGrid(node, index, field, variable) {
  const grids = node.layoutGrids;
  if (!Array.isArray(grids) || index < 0 || index >= grids.length) return false;
  const copy = clonePlain(grids);
  copy[index] = figma.variables.setBoundVariableForLayoutGrid(copy[index], field, variable);
  node.layoutGrids = copy;
  return true;
}

// Applying a text style, or binding a variable to a text field, throws unless the
// font involved is loaded first — the typings say so on textStyleId,
// setTextStyleIdAsync, fontSize, letterSpacing and friends. Both the node's
// CURRENT font and the incoming style's font have to be loaded: the write touches
// one and produces the other.
const loadedFontKeys = new Set();

async function ensureFontsForText(node, targetStyle) {
  if (!node || node.type !== 'TEXT') return;

  const wanted = [];
  const seen = new Set();
  const want = font => {
    if (!font || typeof font.family !== 'string') return;
    const key = font.family + ' ' + font.style;
    if (seen.has(key)) return;
    seen.add(key);
    if (!loadedFontKeys.has(key)) wanted.push({ font, key });
  };

  try {
    const current = node.fontName;
    if (current && current !== figma.mixed) {
      want(current);
    } else {
      // Mixed fonts across ranges — every one of them needs loading.
      for (const segment of node.getStyledTextSegments(['fontName'])) want(segment.fontName);
    }
  } catch (e) {
    log('could not read fonts for', node.id, e);
  }

  if (targetStyle && targetStyle.type === 'TEXT' && targetStyle.fontName) want(targetStyle.fontName);

  for (const entry of wanted) {
    try {
      await figma.loadFontAsync(entry.font);
      loadedFontKeys.add(entry.key);
    } catch (e) {
      // An unavailable font is reported by the write that follows, with a message
      // the user can act on. Failing to load it here is not itself fatal.
      log('font load failed', entry.font, e);
    }
  }
}

const STYLE_SETTERS = {
  'fill style': 'setFillStyleIdAsync',
  'stroke style': 'setStrokeStyleIdAsync',
  'effect style': 'setEffectStyleIdAsync',
  'grid style': 'setGridStyleIdAsync',
  'text style': 'setTextStyleIdAsync'
};

// Is this node inside an instance? Bindings on inherited instance children
// cannot be rebound — the fix belongs on the main component.
function instanceAncestorOf(node) {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'INSTANCE') return parent;
    parent = parent.parent;
  }
  return null;
}

// Apply one reference. Returns { ok, message, kind } — never throws.
async function applyRef(ref, options) {
  const opts = options || {};
  const threshold = opts.threshold || readSettings().autoApply;
  const kindBucket = ref.kind === 'component' ? 'component'
    : ref.kind === 'variable' ? 'variable' : 'style';

  if (ref.manualOnly) {
    return {
      ok: false, kind: kindBucket,
      message: ref.category === 'gradientStop'
        ? 'Gradient stop colours have no rebind API — repair this gradient in Figma.'
        : 'Per-range text fills must be rebound by hand in Figma.'
    };
  }
  // Applying the same reference twice would decrement the stored remote count
  // twice and could show a page as clean while bindings remain. A reference is
  // spent once it has been rebound; the page has to be rescanned to get fresh ones.
  if (ref.fixedAt) {
    return { ok: false, kind: kindBucket, alreadyFixed: true, message: 'Already rebound — rescan the page for current results.' };
  }
  if (ref.nameless) {
    return {
      ok: false, kind: kindBucket,
      message: (ref.broken || 'Reference does not resolve') + ' — no name survives to match a local one against.'
    };
  }

  let match = null;
  if (!opts.targetId) {
    match = ref.kind === 'component'
      ? matchComponentByNames(
          (ref.nameCandidates && ref.nameCandidates.length) ? ref.nameCandidates : [ref.sourceName],
          ref.pageId ? [ref.pageId] : null
        )
      : matchLocal(ref.kind === 'variable' ? 'variable' : ref.kind, ref.sourceName,
          ref.pageId ? [ref.pageId] : null);
    if (!match) {
      return {
        ok: false, kind: kindBucket,
        message: 'No local ' + ref.kind + ' named "' + ref.sourceName +
          '". If you just created one, the local index is rebuilt on the next scan of this page.'
      };
    }
    if (!autoApplicable(match, threshold)) {
      return {
        ok: false, kind: kindBucket, needsReview: true,
        message: match.ambiguous
          ? 'Several local items are named "' + match.targetName + '" — pick one with Remap.'
          : 'Closest local match is "' + match.targetName + '" (' + match.how + ') — confirm it by hand.'
      };
    }
  }
  const resolvedTargetId = opts.targetId || match.targetId;

  const node = await figma.getNodeByIdAsync(ref.nodeId);
  if (!node) {
    return { ok: false, kind: kindBucket, message: 'Layer no longer exists — rescan the page.' };
  }

  try {
    if (ref.category === 'component') {
      return await applyComponentSwap(node, resolvedTargetId, kindBucket);
    }
    if (ref.category === 'style') {
      return await applyStyleFix(node, ref, resolvedTargetId, kindBucket);
    }
    return await applyVariableFix(node, ref, resolvedTargetId, kindBucket);
  } catch (error) {
    return { ok: false, kind: kindBucket, message: describeError(error) };
  }
}

async function applyComponentSwap(node, targetId, kindBucket) {
  if (node.type !== 'INSTANCE') {
    return { ok: false, kind: kindBucket, message: 'Layer is a ' + node.type + ', not an instance.' };
  }
  const target = await figma.getNodeByIdAsync(targetId);
  if (!target) return { ok: false, kind: kindBucket, message: 'Target component no longer exists.' };

  // Swapping into a component SET has to land on the variant that matches the
  // instance's current variant properties. Falling back to defaultVariant would
  // silently reset e.g. Size=Large, State=Hover to the set's defaults.
  const wantedVariant = instanceVariantProperties(node);
  // The match may have landed on the set, or directly on one variant of it via
  // the "Set / Variant" index. Either way the instance's own variant properties
  // decide which variant it should end up on.
  let variantHome = target;
  try {
    if (target.type === 'COMPONENT' && target.parent && target.parent.type === 'COMPONENT_SET') {
      variantHome = target.parent;
    }
  } catch (e) { /* unreachable parent — use the target as found */ }
  const swapTarget = matchingVariant(variantHome, wantedVariant) || resolveMatchTarget(target);
  if (!swapTarget || swapTarget.type !== 'COMPONENT') {
    return { ok: false, kind: kindBucket, message: 'Target is not a usable component.' };
  }
  if (swapTarget.remote) {
    return { ok: false, kind: kindBucket, message: 'Target "' + swapTarget.name + '" is itself a library component.' };
  }

  const before = await node.getMainComponentAsync();
  if (before && before.id === swapTarget.id) {
    return { ok: false, kind: kindBucket, message: 'Already pointing at that component.' };
  }

  const snapshot = snapshotOverrideBindings(node);
  if (typeof node.swapComponentAsync === 'function') {
    await node.swapComponentAsync(swapTarget);
  } else if (typeof node.swapComponent === 'function') {
    node.swapComponent(swapTarget);
  } else {
    return { ok: false, kind: kindBucket, message: 'swapComponent is unavailable on this instance.' };
  }
  const restore = await restoreOverrideBindings(node, snapshot);

  const after = await node.getMainComponentAsync();
  if (!after || after.remote) {
    return {
      ok: false, kind: kindBucket,
      message: 'Swap ran but the main is still remote' + (after ? ' (' + after.name + ')' : '') + '.'
    };
  }
  // Figma's own swap already preserves overrides heuristically; this only reports
  // the variable-bound ones we tried to carry across on top of that. Saying
  // "swapped" while silently dropping some of them is the failure mode this
  // plugin exists to avoid.
  const warning = restore.skipped
    ? restore.skipped + ' variable-bound override' + (restore.skipped === 1 ? '' : 's') +
      ' could not be carried across — check this instance'
    : null;
  return {
    ok: true, kind: kindBucket, newName: after.name, warning,
    message: 'Swapped to local ' + after.name + (warning ? ' · ' + warning : '')
  };
}

async function applyStyleFix(node, ref, targetId, kindBucket) {
  const style = await figma.getStyleByIdAsync(targetId);
  if (!style) return { ok: false, kind: kindBucket, message: 'Target style no longer exists.' };
  if (style.remote) {
    return { ok: false, kind: kindBucket, message: 'Target style "' + style.name + '" is itself from a library.' };
  }

  if (ref.kind === 'text style') await ensureFontsForText(node, style);

  // A style applied to a character range needs the range setter.
  if (typeof ref.start === 'number' && node.type === 'TEXT') {
    if (ref.kind === 'text style' && typeof node.setRangeTextStyleIdAsync === 'function') {
      await node.setRangeTextStyleIdAsync(ref.start, ref.end, style.id);
      return { ok: true, kind: kindBucket, message: 'Rebound characters ' + ref.start + '–' + ref.end, newName: style.name };
    }
    if (ref.kind === 'fill style' && typeof node.setRangeFillStyleIdAsync === 'function') {
      await node.setRangeFillStyleIdAsync(ref.start, ref.end, style.id);
      return { ok: true, kind: kindBucket, message: 'Rebound characters ' + ref.start + '–' + ref.end, newName: style.name };
    }
    return { ok: false, kind: kindBucket, message: 'Range style setter unavailable for ' + ref.kind + '.' };
  }

  const setter = STYLE_SETTERS[ref.kind];
  if (!setter || typeof node[setter] !== 'function') {
    return { ok: false, kind: kindBucket, message: node.type + ' does not accept a ' + ref.kind + '.' };
  }
  await node[setter](style.id);
  return { ok: true, kind: kindBucket, message: 'Rebound to ' + style.name, newName: style.name };
}

async function applyVariableFix(node, ref, targetId, kindBucket) {
  const variable = await figma.variables.getVariableByIdAsync(targetId);
  if (!variable) return { ok: false, kind: kindBucket, message: 'Target variable no longer exists.' };
  if (variable.remote) {
    return { ok: false, kind: kindBucket, message: 'Target variable "' + variable.name + '" is itself from a library.' };
  }

  const owner = instanceAncestorOf(node);
  const done = () => ({ ok: true, kind: kindBucket, message: 'Rebound to ' + variable.name, newName: variable.name });

  try {
    if (ref.category === 'paint') {
      if (!rebindPaint(node, ref.container, ref.index, ref.field, variable)) {
        return { ok: false, kind: kindBucket, message: ref.container + '[' + ref.index + '] no longer exists.' };
      }
      return done();
    }
    if (ref.category === 'effect') {
      if (!rebindEffect(node, ref.index, ref.field, variable)) {
        return { ok: false, kind: kindBucket, message: 'effects[' + ref.index + '] no longer exists.' };
      }
      return done();
    }
    if (ref.category === 'layoutGrid') {
      if (!rebindLayoutGrid(node, ref.index, ref.field, variable)) {
        return { ok: false, kind: kindBucket, message: 'layoutGrids[' + ref.index + '] no longer exists.' };
      }
      return done();
    }
    if (ref.category === 'componentProperty') {
      if (node.type !== 'INSTANCE' || typeof node.setProperties !== 'function') {
        return { ok: false, kind: kindBucket, message: 'Component property bindings live on instances only.' };
      }
      const update = {};
      update[ref.field] = figma.variables.createVariableAlias(variable);
      node.setProperties(update);
      return done();
    }
    if (ref.category === 'textRange') {
      // Rebinds only the characters this binding covers, leaving the rest of the
      // rich text alone.
      if (typeof node.setRangeBoundVariable !== 'function') {
        return { ok: false, kind: kindBucket, message: 'This Figma version cannot rebind per-range text variables.' };
      }
      await ensureFontsForText(node, null);
      node.setRangeBoundVariable(ref.start, ref.end, ref.field, variable);
      return done();
    }
    if (ref.category === 'textRangeFill') {
      if (typeof node.setRangeFills !== 'function' || typeof node.getRangeFills !== 'function') {
        return { ok: false, kind: kindBucket, message: 'This Figma version cannot rebind per-range text fills.' };
      }
      await ensureFontsForText(node, null);
      const fills = node.getRangeFills(ref.start, ref.end);
      if (!Array.isArray(fills) || !fills[ref.index]) {
        return { ok: false, kind: kindBucket, message: 'Fills changed within characters ' + ref.start + '–' + ref.end + ' — rescan the page.' };
      }
      const copy = clonePlain(fills);
      copy[ref.index] = figma.variables.setBoundVariableForPaint(copy[ref.index], ref.field || 'color', variable);
      node.setRangeFills(ref.start, ref.end, copy);
      return done();
    }
    // scalar + text fields
    if (typeof node.setBoundVariable !== 'function') {
      return { ok: false, kind: kindBucket, message: node.type + ' does not support variable bindings.' };
    }
    // fontSize / lineHeight / letterSpacing and the rest of the text fields
    // require the font to be loaded before the write.
    if (ref.category === 'text') await ensureFontsForText(node, null);
    node.setBoundVariable(ref.field, variable);
    return done();
  } catch (error) {
    // Being inside an instance is the usual reason a bind is rejected, but it is
    // not the only one — report the real message and only add the instance as
    // context, rather than replacing the cause with a guess.
    const detail = describeError(error);
    return {
      ok: false, kind: kindBucket,
      message: owner
        ? detail + ' (layer is inside instance "' + owner.name + '" — the fix may belong on its main component)'
        : detail
    };
  }
}

// Drop a variable binding while keeping the value it currently resolves to. For a
// reference that cannot be rebound — the variable was deleted from its collection
// and no local equivalent exists — a literal value is strictly better than a
// dangling pointer: it renders identically, and it does not keep the file tied to
// a library that no longer has the token.
//
// Every setter documents null as "unbind this field", and none of them touch the
// resolved value, so the layer looks the same afterwards. Undo in Figma reverses
// it like any other edit.
async function unbindRef(ref) {
  const kindBucket = 'variable';
  if (ref.kind !== 'variable') {
    return { ok: false, kind: kindBucket, message: 'Only variable bindings can be unbound.' };
  }
  if (ref.fixedAt) {
    return { ok: false, kind: kindBucket, message: 'Already changed — rescan the page for current results.' };
  }
  if (ref.category === 'gradientStop') {
    return { ok: false, kind: kindBucket, message: 'Gradient stop bindings have no unbind API — edit the gradient in Figma.' };
  }

  const node = await figma.getNodeByIdAsync(ref.nodeId);
  if (!node) {
    return { ok: false, kind: kindBucket, message: 'Layer no longer exists — rescan the page.' };
  }

  const owner = instanceAncestorOf(node);
  try {
    if (ref.category === 'paint') {
      if (!rebindPaint(node, ref.container, ref.index, ref.field, null)) {
        return { ok: false, kind: kindBucket, message: ref.container + '[' + ref.index + '] no longer exists.' };
      }
    } else if (ref.category === 'effect') {
      if (!rebindEffect(node, ref.index, ref.field, null)) {
        return { ok: false, kind: kindBucket, message: 'effects[' + ref.index + '] no longer exists.' };
      }
    } else if (ref.category === 'layoutGrid') {
      if (!rebindLayoutGrid(node, ref.index, ref.field, null)) {
        return { ok: false, kind: kindBucket, message: 'layoutGrids[' + ref.index + '] no longer exists.' };
      }
    } else if (ref.category === 'textRange') {
      if (typeof node.setRangeBoundVariable !== 'function') {
        return { ok: false, kind: kindBucket, message: 'This Figma version cannot unbind per-range text variables.' };
      }
      await ensureFontsForText(node, null);
      node.setRangeBoundVariable(ref.start, ref.end, ref.field, null);
    } else if (ref.category === 'textRangeFill') {
      if (typeof node.setRangeFills !== 'function' || typeof node.getRangeFills !== 'function') {
        return { ok: false, kind: kindBucket, message: 'This Figma version cannot unbind per-range text fills.' };
      }
      await ensureFontsForText(node, null);
      const fills = node.getRangeFills(ref.start, ref.end);
      if (!Array.isArray(fills) || !fills[ref.index]) {
        return { ok: false, kind: kindBucket, message: 'Fills changed within characters ' + ref.start + '–' + ref.end + ' — rescan the page.' };
      }
      const copy = clonePlain(fills);
      copy[ref.index] = figma.variables.setBoundVariableForPaint(copy[ref.index], ref.field || 'color', null);
      node.setRangeFills(ref.start, ref.end, copy);
    } else if (ref.category === 'componentProperty') {
      if (node.type !== 'INSTANCE' || typeof node.setProperties !== 'function') {
        return { ok: false, kind: kindBucket, message: 'Component property bindings live on instances only.' };
      }
      // Re-set the property to the value it currently resolves to, which drops
      // the alias and keeps the instance looking the same.
      const props = node.componentProperties || {};
      const current = props[ref.field];
      if (!current) {
        return { ok: false, kind: kindBucket, message: 'Property "' + ref.field + '" is no longer on this instance.' };
      }
      const update = {};
      update[ref.field] = current.value;
      node.setProperties(update);
    } else {
      if (typeof node.setBoundVariable !== 'function') {
        return { ok: false, kind: kindBucket, message: node.type + ' does not support variable bindings.' };
      }
      if (ref.category === 'text') await ensureFontsForText(node, null);
      node.setBoundVariable(ref.field, null);
    }
    return { ok: true, kind: kindBucket, message: 'Unbound ' + ref.sourceName + ', value kept', newName: null };
  } catch (error) {
    const detail = describeError(error);
    return {
      ok: false, kind: kindBucket,
      message: owner
        ? detail + ' (layer is inside instance "' + owner.name + '" — unbind it on the main component)'
        : detail
    };
  }
}

// Is this reference one that "Fix" can never resolve on its own? Used to offer
// unbinding exactly where rebinding is not an option.
function isUnfixableVariable(ref) {
  if (ref.kind !== 'variable') return false;
  if (ref.manualOnly || ref.nameless) return false; // cannot be unbound either
  if (ref.category === 'gradientStop') return false;
  const match = matchLocal('variable', ref.sourceName, ref.pageId ? [ref.pageId] : null);
  return !match || match.confidence === 'risky' || match.ambiguous;
}

// A dry run. Same matcher, same threshold, no writes — so the user can see what
// "Fix page" would actually do before it does it.
function planForRefs(refs, threshold) {
  const plan = { apply: [], review: [], blocked: [] };
  for (const ref of refs) {
    if (ref.manualOnly) {
      plan.blocked.push(planRow(ref, null, 'Must be fixed by hand in Figma'));
      continue;
    }
    if (ref.fixedAt) {
      plan.blocked.push(planRow(ref, null, 'Already rebound in this session'));
      continue;
    }
    if (ref.nameless) {
      plan.blocked.push(planRow(ref, null, (ref.broken || 'Does not resolve') + ' — no name to match on'));
      continue;
    }
    const match = ref.kind === 'component'
      ? matchComponentByNames(
          (ref.nameCandidates && ref.nameCandidates.length) ? ref.nameCandidates : [ref.sourceName],
          ref.pageId ? [ref.pageId] : null
        )
      : matchLocal(ref.kind === 'variable' ? 'variable' : ref.kind, ref.sourceName,
          ref.pageId ? [ref.pageId] : null);
    if (!match) {
      plan.blocked.push(planRow(ref, null, 'No local ' + ref.kind + ' with that name'));
    } else if (autoApplicable(match, threshold)) {
      plan.apply.push(planRow(ref, match, match.how));
    } else {
      plan.review.push(planRow(ref, match, match.how));
    }
  }
  return plan;
}

function planRow(ref, match, reason) {
  return {
    refId: ref.refId,
    kind: ref.kind,
    sourceName: ref.sourceName,
    targetName: match ? match.targetName : null,
    targetId: match ? match.targetId : null,
    confidence: match ? match.confidence : null,
    ambiguous: match ? !!match.ambiguous : false,
    reason
  };
}

// Accepts one scope key or several, so a fix can span a multi-page selection.
// Deduped by ref id: the same reference legitimately belongs to both a page scope
// and the selection scope, and applying it twice would double-count the fix.
function refsForScopes(scopeKeys) {
  const keys = Array.isArray(scopeKeys) ? scopeKeys : [scopeKeys];
  const seen = new Set();
  const refs = [];
  for (const key of keys) {
    const ids = refIdsByScope.get(key);
    if (!ids) continue;
    for (const refId of ids) {
      if (seen.has(refId)) continue;
      seen.add(refId);
      const ref = refStore.get(refId);
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

function normaliseScopeKeys(msg) {
  if (Array.isArray(msg.scopeKeys) && msg.scopeKeys.length) return msg.scopeKeys;
  return msg.scopeKey ? [msg.scopeKey] : [];
}

function summarisePlan(plan) {
  const countByKind = rows => {
    const out = { component: 0, style: 0, variable: 0 };
    for (const row of rows) {
      const bucket = row.kind === 'component' ? 'component' : row.kind === 'variable' ? 'variable' : 'style';
      out[bucket]++;
    }
    return out;
  };
  return {
    applyCount: plan.apply.length,
    reviewCount: plan.review.length,
    blockedCount: plan.blocked.length,
    byKind: countByKind(plan.apply)
  };
}

async function handlePlanFixes(scopeKeys) {
  const settings = readSettings();
  await ensureFreshLocalIndex();
  const plan = planForRefs(refsForScopes(scopeKeys), settings.autoApply);
  figma.ui.postMessage({
    type: 'fix-plan',
    scopeKeys,
    plan: {
      apply: plan.apply.slice(0, 400),
      review: plan.review.slice(0, 400),
      blocked: plan.blocked.slice(0, 400),
      truncated: plan.apply.length > 400 || plan.review.length > 400 || plan.blocked.length > 400
    },
    summary: summarisePlan(plan)
  });
}

// Apply in dependency order: components first (a swap re-links a whole subtree
// and invalidates its descendants' refs), then styles, then variables.
const APPLY_ORDER = { component: 0, style: 1, variable: 2 };

async function handleApplyFixes(scopeKeys, options) {
  const opts = options || {};
  const gen = beginRun();
  const settings = readSettings();
  const effectiveThreshold = opts.threshold || settings.autoApply;

  await ensureFreshLocalIndex();

  const unbinding = opts.mode === 'unbind';

  let refs;
  if (Array.isArray(opts.refIds) && opts.refIds.length) {
    refs = opts.refIds.map(refId => refStore.get(refId)).filter(Boolean);
  } else if (opts.unfixableOnly) {
    // Everything on this page that Fix can never resolve. Computed here rather
    // than trusted from the UI, so the set matches what the engine believes.
    refs = refsForScopes(scopeKeys).filter(isUnfixableVariable);
  } else if (opts.groupKey) {
    // "Fix N" on a group row. The UI only holds the first MAX_OCCURRENCES rows,
    // so the group is re-derived here to cover every occurrence.
    refs = refsForScopes(scopeKeys).filter(ref => refGroupKey(ref) === opts.groupKey);
  } else if (Array.isArray(opts.ownerComponentIds) && opts.ownerComponentIds.length) {
    // Everything inside the given main components, across whatever pages they
    // live on — this is the "fix the source, not the symptoms" path.
    const owners = new Set(opts.ownerComponentIds);
    refs = [];
    for (const scopeKey of refIdsByScope.keys()) {
      if (scopeKey.indexOf('page:') !== 0) continue;
      for (const refId of refIdsByScope.get(scopeKey)) {
        const ref = refStore.get(refId);
        if (ref && owners.has(ref.ownerComponentId)) refs.push(ref);
      }
    }
  } else if (Array.isArray(opts.groupKeys) && opts.groupKeys.length) {
    // A checkbox selection across several groups. Same reasoning as above: the
    // group keys are re-expanded here so occurrences past the display cap are
    // covered too.
    const wanted = new Set(opts.groupKeys);
    refs = refsForScopes(scopeKeys).filter(ref => wanted.has(refGroupKey(ref)));
  } else {
    refs = refsForScopes(scopeKeys);
  }
  refs = refs.slice().sort((a, b) => {
    const ka = a.kind === 'component' ? 'component' : a.kind === 'variable' ? 'variable' : 'style';
    const kb = b.kind === 'component' ? 'component' : b.kind === 'variable' ? 'variable' : 'style';
    return APPLY_ORDER[ka] - APPLY_ORDER[kb];
  });

  const results = [];
  const applied = { component: 0, style: 0, variable: 0 };
  const appliedByPage = new Map();
  const componentSwapPages = new Set();
  let failed = 0;
  let review = 0;
  let warnings = 0;

  isApplying = true;
  try {
    for (let i = 0; i < refs.length; i++) {
      if (isStale(gen)) break;
      const ref = refs[i];
      // A group fix carries the exact target shown on the row, so it applies
      // what the user saw rather than re-deciding via the threshold.
      // Each group carries its own target, so a multi-group batch applies the
      // match shown next to each one instead of collapsing them onto a single
      // target or re-judging them against the bulk threshold.
      let targetId = opts.targetId || null;
      if (!targetId && opts.groupTargets) {
        targetId = opts.groupTargets[refGroupKey(ref)] || null;
      }
      const result = unbinding
        ? await unbindRef(ref)
        : await applyRef(ref, { threshold: effectiveThreshold, targetId });
      results.push({
        refId: ref.refId, kind: ref.kind, sourceName: ref.sourceName,
        ok: result.ok, message: result.message, needsReview: !!result.needsReview,
        warning: result.warning || null
      });
      if (result.warning) warnings++;
      if (result.ok) {
        ref.fixedAt = Date.now();
        applied[result.kind]++;
        // Attribute the change to the page the reference lives on, not to the
        // scope. A selection can span only one page, but a selection-scope fix
        // still has to correct that page's stored count.
        if (ref.pageId) {
          if (!appliedByPage.has(ref.pageId)) {
            appliedByPage.set(ref.pageId, { component: 0, style: 0, variable: 0 });
          }
          appliedByPage.get(ref.pageId)[result.kind]++;
        }
        // A component swap re-links a whole subtree, so descendant style and
        // variable references vanish too and cannot be counted here. Flag the
        // page as needing a rescan rather than leaving a phantom count behind.
        if (result.kind === 'component') componentSwapPages.add(ref.pageId);
      } else if (result.needsReview) review++;
      else failed++;

      if (i % 10 === 0 || i === refs.length - 1) {
        figma.ui.postMessage({
          type: 'fix-progress', done: i + 1, total: refs.length,
          message: (unbinding ? 'Unbinding ' : 'Rebinding ') + (i + 1) + '/' + refs.length + '…'
        });
        await nextTick();
      }
    }
  } finally {
    isApplying = false;
  }

  // A swap or rebind changes the tree, so cached node references for this scope
  // are no longer trustworthy. Update the stored count from what we actually did
  // rather than guessing, and tell the UI the scope needs a rescan.
  const entries = {};
  for (const [pageId, delta] of appliedByPage) {
    const updated = adjustIndexRemote(pageId, delta);
    if (updated) entries[pageId] = updated;
  }
  for (const pageId of componentSwapPages) {
    if (pageId) markPageDirty(pageId);
  }
  const touchedPageIds = Array.from(appliedByPage.keys()).filter(Boolean);

  figma.ui.postMessage({
    type: 'fix-done',
    scopeKeys,
    mode: unbinding ? 'unbind' : 'rebind',
    applied,
    appliedTotal: applied.component + applied.style + applied.variable,
    failed,
    review,
    warnings,
    results: results.slice(0, 500),
    truncated: results.length > 500,
    pageIds: touchedPageIds,
    entries
  });
}

async function handleFixRef(refId, targetId) {
  const ref = refStore.get(refId);
  if (!ref) {
    figma.ui.postMessage({ type: 'ref-result', refId, ok: false, message: 'Reference is stale — rescan the page.' });
    return;
  }
  await ensureFreshLocalIndex();
  isApplying = true;
  let result;
  try {
    // An explicit target means the user clicked Fix on a row whose match is on
    // screen above it. That is a deliberate choice about a visible target, so it
    // is not re-judged against the bulk auto-apply threshold — otherwise the row
    // button refuses exactly what the group button next to it applies.
    result = await applyRef(ref, targetId ? { targetId } : {});
  } finally {
    isApplying = false;
  }
  let entry = null;
  if (result.ok && ref.pageId) {
    ref.fixedAt = Date.now();
    const delta = { component: 0, style: 0, variable: 0 };
    delta[result.kind] = 1;
    entry = adjustIndexRemote(ref.pageId, delta);
    // A swap takes its descendants' references with it, so the remaining count
    // is a guess until the page is rescanned. Say so rather than imply precision.
    if (result.kind === 'component') markPageDirty(ref.pageId);
  } else if (result.ok) {
    ref.fixedAt = Date.now();
  }
  figma.ui.postMessage({
    type: 'ref-result', refId, ok: result.ok, message: result.message,
    newName: result.newName || null, needsReview: !!result.needsReview,
    pageId: ref.pageId || null, entry
  });
}

async function handleRemapRef(refId, targetId) {
  const ref = refStore.get(refId);
  if (!ref) {
    figma.ui.postMessage({ type: 'ref-result', refId, ok: false, message: 'Reference is stale — rescan the page.' });
    return;
  }
  isApplying = true;
  let result;
  try {
    result = await applyRef(ref, { targetId });
  } finally {
    isApplying = false;
  }
  let entry = null;
  if (result.ok && ref.pageId) {
    ref.fixedAt = Date.now();
    const delta = { component: 0, style: 0, variable: 0 };
    delta[result.kind] = 1;
    entry = adjustIndexRemote(ref.pageId, delta);
    // A swap takes its descendants' references with it, so the remaining count
    // is a guess until the page is rescanned. Say so rather than imply precision.
    if (result.kind === 'component') markPageDirty(ref.pageId);
  } else if (result.ok) {
    ref.fixedAt = Date.now();
  }
  figma.ui.postMessage({
    type: 'ref-result', refId, ok: result.ok, message: result.message,
    newName: result.newName || null, pageId: ref.pageId || null, entry
  });
}

// ── Remap candidates ───────────────────────────────────────────────────────

async function handleRemapCandidates(refId) {
  const ref = refStore.get(refId);
  if (!ref) {
    figma.ui.postMessage({ type: 'remap-candidates', refId, candidates: [], error: 'Reference is stale.' });
    return;
  }
  try {
    await ensureFreshLocalIndex();
    const kind = ref.kind === 'component' ? 'component' : (ref.kind === 'variable' ? 'variable' : ref.kind);
    const set = candidateSet(kind);
    const list = set ? set.list : [];
    const scored = list.map(item => {
      const page = kind === 'component' ? pageOfComponent(item) : null;
      return {
        id: item.id,
        name: item.name,
        type: item.type || null,
        pageName: page ? page.pageName : null,
        onScopePage: !!(page && ref.pageId && page.pageId === ref.pageId),
        score: similarity(ref.sourceName, item.name),
        risky: looksLikeSiblingToken(ref.sourceName, item.name)
      };
    });
    // Sibling tokens sink to the bottom: they score high on edit distance but are
    // exactly the wrong answer.
    scored.sort((a, b) => {
      if (a.risky !== b.risky) return a.risky ? 1 : -1;
      // Candidates on the page being fixed float up, matching how the automatic
      // matcher chooses.
      if (a.onScopePage !== b.onScopePage) return a.onScopePage ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
    figma.ui.postMessage({
      type: 'remap-candidates',
      refId,
      kind,
      currentName: ref.sourceName,
      candidates: scored.slice(0, 400)
    });
  } catch (error) {
    figma.ui.postMessage({ type: 'remap-candidates', refId, candidates: [], error: describeError(error) });
  }
}

// ── Navigation ─────────────────────────────────────────────────────────────

async function handleInspectRef(refId) {
  const ref = refStore.get(refId);
  if (!ref) {
    figma.ui.postMessage({ type: 'ref-stale', refId, message: 'Reference is stale — rescan the page.' });
    return;
  }
  try {
    const node = await figma.getNodeByIdAsync(ref.nodeId);
    if (!node) {
      figma.ui.postMessage({ type: 'ref-stale', refId, message: 'Layer no longer exists.' });
      return;
    }
    let ancestor = node;
    while (ancestor && ancestor.type !== 'PAGE') ancestor = ancestor.parent;
    if (ancestor && ancestor.type === 'PAGE' && ancestor.id !== figma.currentPage.id) {
      await figma.setCurrentPageAsync(ancestor);
    }
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    figma.ui.postMessage({ type: 'toast', kind: 'info', message: 'Selected ' + node.name });
  } catch (error) {
    figma.ui.postMessage({ type: 'ref-stale', refId, message: describeError(error) });
  }
}

// ── Init state ─────────────────────────────────────────────────────────────

function buildInitState() {
  const ignored = new Set(getIgnoredPageIds());
  const stored = figma.root.getPluginData(INDEX_KEY);
  const index = readIndex();
  const pages = getAllPages().map(page => {
    const entry = index.pages[page.id] || null;
    // Keep the stored name in step with reality so a rename doesn't leave the
    // index describing a page that no longer has that title.
    if (entry && entry.name !== page.name) {
      entry.name = page.name;
    }
    return {
      id: page.id,
      name: page.name,
      ignored: ignored.has(page.id),
      entry,
      // Whether this count was produced now or restored from the document. Only
      // the former can be vouched for — nothing observed edits made while the
      // plugin was closed.
      verifiedThisSession: scannedThisSession.has(page.id),
      hasDetails: pageReports.has(page.id)
    };
  });
  // readIndex() also prunes deleted pages and migrates the pre-v2 blob, so the
  // in-memory index can legitimately differ from what is stored. Only persist
  // when it actually does — every setPluginData on figma.root is an undo-stack
  // entry, and merely opening the plugin should not create one.
  const serialised = JSON.stringify({ v: 2, pages: index.pages });
  const isEmpty = Object.keys(index.pages).length === 0;
  if (serialised !== stored && !(isEmpty && !stored) && !indexIsSlim) writeIndex(index);

  return {
    pages,
    currentPageId: figma.currentPage.id,
    settings: readSettings(),
    localCounts: localIndex ? localIndex.counts : null,
    fileName: figma.root.name
  };
}

function describeError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

// ── Events ─────────────────────────────────────────────────────────────────

try {
  figma.on('stylechange', () => { noteDocumentTouched(); });
} catch (e) {
  log('stylechange unavailable', e);
}

figma.on('currentpagechange', () => {
  watchPage(figma.currentPage);
  figma.ui.postMessage({ type: 'current-page', pageId: figma.currentPage.id });
});

figma.on('selectionchange', () => {
  figma.ui.postMessage({
    type: 'selection-changed',
    count: figma.currentPage.selection.length
  });
});

// The open page is the one most likely to be edited while the plugin is up.
ensurePageLoaded(figma.currentPage).catch(() => {});

// ── Message routing ────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  try {
    switch (msg.type) {
      case 'init':
        figma.ui.postMessage({ type: 'init-state', state: buildInitState() });
        break;

      case 'scan-page':
        await handleScanPage(msg.pageId, !!msg.force);
        break;

      case 'scan-all':
        await handleScanAll(!!msg.force, msg.pageIds);
        break;

      case 'scan-selection':
        await handleScanSelection();
        break;

      case 'audit-document':
        await handleAuditDocument();
        break;

      case 'component-impact':
        await handleComponentImpact();
        break;

      // Fix a reference at its source. The main may sit on a page this session
      // has never scanned, in which case there are no references for it yet —
      // scan that page first, then fix everything inside the main.
      case 'fix-in-main': {
        const main = await figma.getNodeByIdAsync(msg.mainId);
        if (!main) {
          figma.ui.postMessage({ type: 'toast', kind: 'error', message: 'Main component no longer exists.' });
          break;
        }
        if (main.remote) {
          figma.ui.postMessage({
            type: 'toast', kind: 'error',
            message: '"' + main.name + '" is a library component — swap the instance to a local one instead.'
          });
          break;
        }
        let mainPage = main.parent;
        while (mainPage && mainPage.type !== 'PAGE') mainPage = mainPage.parent;
        if (!mainPage) {
          figma.ui.postMessage({ type: 'toast', kind: 'error', message: 'That component is not on any page.' });
          break;
        }

        // The set is what carries the references, so fix the whole set when the
        // main is one of its variants.
        let ownerId = main.id;
        try {
          if (main.parent && main.parent.type === 'COMPONENT_SET') ownerId = main.parent.id;
        } catch (e) { /* keep the main itself */ }

        const gen = beginRun();
        const already = pageReports.has(mainPage.id);
        if (!already) {
          figma.ui.postMessage({
            type: 'toast', kind: 'info',
            message: 'Scanning ' + mainPage.name + ' to reach the component…'
          });
          const report = await scanPage(mainPage.id, gen, (message, processed, total) => {
            postProgress({ message, processed: processed || 0, total: total || 0, pageName: mainPage.name, cancellable: true });
          });
          if (!report) { endProgress(); break; }
          const entry = setIndexEntry(mainPage.id, entryFromReport(report, mainPage.name));
          figma.ui.postMessage({ type: 'page-scanned', pageId: mainPage.id, entry, hasRefs: true });
        }
        await handleApplyFixes([], { ownerComponentIds: [ownerId] });
        break;
      }

      case 'inspect-owner': {
        const node = await figma.getNodeByIdAsync(msg.ownerId);
        if (!node) {
          figma.ui.postMessage({ type: 'toast', kind: 'error', message: 'Component no longer exists.' });
          break;
        }
        let ownerPage = node.parent;
        while (ownerPage && ownerPage.type !== 'PAGE') ownerPage = ownerPage.parent;
        if (ownerPage && ownerPage.type === 'PAGE' && ownerPage.id !== figma.currentPage.id) {
          await figma.setCurrentPageAsync(ownerPage);
        }
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
        figma.ui.postMessage({ type: 'toast', kind: 'info', message: 'Selected ' + node.name });
        break;
      }

      case 'cancel':
        cancelRun();
        endProgress();
        figma.ui.postMessage({ type: 'scan-cancelled', completed: null });
        break;

      case 'plan-fixes':
        await handlePlanFixes(normaliseScopeKeys(msg));
        break;

      case 'apply-fixes':
        await handleApplyFixes(normaliseScopeKeys(msg), {
          refIds: msg.refIds,
          groupKey: msg.groupKey,
          groupKeys: msg.groupKeys,
          groupTargets: msg.groupTargets,
          ownerComponentIds: msg.ownerComponentIds,
          targetId: msg.targetId,
          threshold: msg.threshold,
          mode: msg.mode,
          unfixableOnly: msg.unfixableOnly
        });
        break;

      case 'fix-ref':
        await handleFixRef(msg.refId, msg.targetId);
        break;

      case 'remap-candidates':
        await handleRemapCandidates(msg.refId);
        break;

      case 'remap-ref':
        await handleRemapRef(msg.refId, msg.targetId);
        break;

      case 'inspect-ref':
        await handleInspectRef(msg.refId);
        break;

      case 'goto-page': {
        const page = findPage(msg.pageId);
        if (!page) {
          figma.ui.postMessage({ type: 'toast', kind: 'error', message: 'Page no longer exists.' });
          break;
        }
        await figma.setCurrentPageAsync(page);
        figma.ui.postMessage({ type: 'toast', kind: 'info', message: 'Switched to ' + page.name });
        break;
      }

      case 'toggle-ignore-page': {
        const ignored = new Set(getIgnoredPageIds());
        if (ignored.has(msg.pageId)) ignored.delete(msg.pageId);
        else {
          ignored.add(msg.pageId);
          const index = readIndex();
          delete index.pages[msg.pageId];
          writeIndex(index);
          pageReports.delete(msg.pageId);
          clearScope('page:' + msg.pageId);
        }
        setIgnoredPageIds(Array.from(ignored));
        figma.ui.postMessage({ type: 'init-state', state: buildInitState() });
        break;
      }

      case 'set-settings': {
        const settings = readSettings();
        if (msg.patch && typeof msg.patch === 'object') Object.assign(settings, msg.patch);
        writeSettings(settings);
        figma.ui.postMessage({ type: 'settings', settings: readSettings() });
        break;
      }

      case 'clear-index':
        writeIndex(emptyIndex());
        pageReports.clear();
        for (const scopeKey of Array.from(refIdsByScope.keys())) clearScope(scopeKey);
        figma.ui.postMessage({ type: 'init-state', state: buildInitState() });
        figma.ui.postMessage({ type: 'toast', kind: 'info', message: 'Scan index cleared.' });
        break;

      case 'rebuild-local-index':
        styleMetaCache.clear();
        variableMetaCache.clear();
        collectionMetaCache.clear();
        libraryNameByCollectionKey = null;
        try {
          postProgress({ message: 'Rebuilding local index…', processed: 0, total: 0, cancellable: false });
          const index = await buildLocalIndex(true);
          figma.ui.postMessage({ type: 'local-index', counts: index.counts });
        } finally {
          endProgress();
        }
        break;

      case 'close':
        figma.closePlugin();
        break;
    }
  } catch (error) {
    console.error('Handler failed for', msg && msg.type, error);
    endProgress();
    figma.ui.postMessage({ type: 'error', message: describeError(error) });
  }
};
