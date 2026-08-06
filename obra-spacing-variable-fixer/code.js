// code.js
var spacingVariables = [];
var variableCollections = [];
var selectedCollectionIds = []; // Ordered array: earlier = preferred rank. Empty = no filter (all)
var ignoredLayerNames = ['Labels', 'Label', 'Bracket', 'Instances', 'Instance'];

// Scan bookkeeping
var currentGen = 0;
var isApplying = false;             // suppresses dirty-marking while we apply our own fixes
var watchedPageIds = {};            // pageId -> true, pages with a nodechange listener attached
var dirtyPages = {};                // pageId -> true, edited since last scan THIS session
var scannedThisSession = {};        // pageId -> true, scanned at least once this session
var pageReports = {};               // pageId -> array of layer issue objects (full, in-memory only)
var pageNames = {};                 // pageId -> name (cached for pages we've touched)

var currentView = { kind: null, pageId: null }; // which report apply/autofix/navigate should act on
var currentViewLayers = [];

var INDEX_KEY = 'obraSpacingScan.index.v1';

// Divider pages (e.g. "---", "===", "• • •") are a common Figma convention
// for visually separating groups of pages in the pages list - they're not
// real content, so we skip listing and scanning them.
var DIVIDER_PAGE_PATTERN = /^[\s\-_=~*.•·▔─━∙⸻–—]+$/;
function isDividerPage(name) {
  return DIVIDER_PAGE_PATTERN.test(name);
}
function realPages() {
  return figma.root.children.filter(function(p) { return !isDividerPage(p.name); });
}

// Initialize the plugin
figma.showUI(__html__, { width: 820, height: 620, themeColors: true });

loadIgnoredNames();
loadSelectedCollections().then(function() {
  scanForSpacingVariables();
});
sendPagesSnapshot();
watchPage(figma.currentPage);
figma.on('currentpagechange', function() {
  watchPage(figma.currentPage);
  figma.ui.postMessage({ type: 'page-changed', pageId: figma.currentPage.id, pageName: figma.currentPage.name });
});

// ---------------------------------------------------------------------------
// Generation-based cancellation (a boolean can't tell "cancelled" from
// "superseded by a newer scan", and would falsely report stale results)
// ---------------------------------------------------------------------------
function nextTick() {
  return new Promise(function(resolve) { setTimeout(resolve, 0); });
}

function beginRun() {
  currentGen++;
  return currentGen;
}

function isStale(gen) {
  return gen !== currentGen;
}

function cancelScan() {
  currentGen++;
  figma.ui.postMessage({ type: 'scan-cancelled' });
}

// ---------------------------------------------------------------------------
// Per-page scan index — persisted on the document itself (figma.root plugin
// data) so it travels with the file instead of being scoped to this machine.
// Only counts are persisted; full per-layer reports stay in memory for this
// session (pageReports) so re-opening a page you already scanned is instant.
// ---------------------------------------------------------------------------
function readIndex() {
  try {
    var raw = figma.root.getPluginData(INDEX_KEY);
    if (!raw) return { pages: {} };
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { pages: {} };
    if (!parsed.pages) parsed.pages = {};
    return parsed;
  } catch (e) {
    console.log('Error reading scan index:', e.message);
    return { pages: {} };
  }
}

function writeIndex(index) {
  try {
    figma.root.setPluginData(INDEX_KEY, JSON.stringify(index));
  } catch (e) {
    console.log('Error writing scan index:', e.message);
  }
}

function setIndexEntry(pageId, entry) {
  var index = readIndex();
  index.pages[pageId] = entry;
  writeIndex(index);
  return entry;
}

// Captures the settings that affect scan results. If ignored names or the
// selected collections change, any cached entry stops matching this key and
// is treated as stale automatically - no manual invalidation needed.
function computeParamsKey() {
  var names = ignoredLayerNames.slice().sort().join(',');
  var colls = selectedCollectionIds.join(','); // order matters here (preference rank)
  return names + '||' + colls;
}

function entryFromLayers(pageName, layers) {
  var fixable = 0, noMatch = 0, alreadyFixed = 0, componentFixable = 0;
  for (var i = 0; i < layers.length; i++) {
    if (layers[i].issueType === 'missing_variable') {
      fixable++;
      if (layers[i].type === 'COMPONENT') componentFixable++;
    } else if (layers[i].issueType === 'no_matching_variable') noMatch++;
    else if (layers[i].issueType === 'has_variable') alreadyFixed++;
  }
  return {
    name: pageName,
    total: layers.length,
    fixable: fixable,
    componentFixable: componentFixable,
    noMatch: noMatch,
    alreadyFixed: alreadyFixed,
    problems: fixable + noMatch,
    scannedAt: Date.now(),
    dirty: false,
    paramsKey: computeParamsKey()
  };
}

// Attach a nodechange listener to a loaded page exactly once. In dynamic-page
// documents there's no single document-wide change event, so each page we
// touch needs its own listener to know when it's been edited since we scanned
// it. A stored index entry from a previous session is only ever trusted once
// this session has actually scanned (and therefore is watching) that page.
function watchPage(page) {
  if (!page || watchedPageIds[page.id]) return;
  watchedPageIds[page.id] = true;
  try {
    page.on('nodechange', function() {
      if (isApplying) return; // our own fixes shouldn't mark the page dirty
      markPageDirty(page.id);
    });
  } catch (e) {
    console.log('Error attaching nodechange listener:', e.message);
  }
}

function markPageDirty(pageId) {
  dirtyPages[pageId] = true;
  var index = readIndex();
  if (index.pages[pageId] && !index.pages[pageId].dirty) {
    index.pages[pageId].dirty = true;
    writeIndex(index);
  }
  figma.ui.postMessage({ type: 'page-dirty', pageId: pageId });
}

// Page stubs (id/name) are available without loading a page's contents in
// dynamic-page documents, so the sidebar can list every page - and show
// last-known badges from the persisted index - before anything is scanned.
function sendPagesSnapshot() {
  var index = readIndex();
  var pages = realPages().map(function(p) {
    pageNames[p.id] = p.name;
    var entry = index.pages[p.id];
    return {
      id: p.id,
      name: p.name,
      total: entry ? entry.total : null,
      fixable: entry ? entry.fixable : null,
      componentFixable: entry ? entry.componentFixable : null,
      noMatch: entry ? entry.noMatch : null,
      alreadyFixed: entry ? entry.alreadyFixed : null,
      problems: entry ? entry.problems : null,
      scannedAt: entry ? entry.scannedAt : null,
      dirty: entry ? entry.dirty : false
    };
  });
  figma.ui.postMessage({ type: 'pages-found', pages: pages, currentPageId: figma.currentPage.id });
}

// Helper function to resolve variable value (handles aliases/references)
async function resolveVariableValue(variable, modeId) {
  var valuesByMode = variable.valuesByMode;
  if (!valuesByMode || valuesByMode[modeId] === undefined) {
    return null;
  }

  var value = valuesByMode[modeId];

  // If it's a direct number, return it
  if (typeof value === 'number') {
    return value;
  }

  // If it's a variable alias (reference), resolve it
  if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
    try {
      var referencedVar = await figma.variables.getVariableByIdAsync(value.id);
      if (referencedVar) {
        // Get the referenced variable's collection to find its mode
        var refCollection = await figma.variables.getVariableCollectionByIdAsync(referencedVar.variableCollectionId);
        if (refCollection && refCollection.modes && refCollection.modes.length > 0) {
          var refModeId = refCollection.modes[0].modeId;
          // Recursively resolve in case of chained references
          return await resolveVariableValue(referencedVar, refModeId);
        }
      }
    } catch (e) {
      console.log('Error resolving variable alias:', e.message);
    }
  }

  return null;
}

// Scan for all spacing variables and their values
async function scanForSpacingVariables() {
  console.log('Starting variable scan...');
  spacingVariables = [];
  variableCollections = [];

  try {
    // Get all local variable collections first
    var allCollections = await figma.variables.getLocalVariableCollectionsAsync();
    var collectionMap = {};
    for (var c = 0; c < allCollections.length; c++) {
      var coll = allCollections[c];
      collectionMap[coll.id] = coll;
      variableCollections.push({
        id: coll.id,
        name: coll.name,
        isLibrary: false
      });
    }
    console.log('Found', variableCollections.length, 'local variable collections');

    // Also get library variable collections
    try {
      var libraryCollections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
      console.log('Found', libraryCollections.length, 'library variable collections');

      for (var lc = 0; lc < libraryCollections.length; lc++) {
        var libColl = libraryCollections[lc];
        console.log('Library collection:', libColl.name, 'from', libColl.libraryName);

        // Import variables from this library collection
        try {
          var libVars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libColl.key);
          console.log('Found', libVars.length, 'variables in library collection', libColl.name);

          // Add to collections list
          variableCollections.push({
            id: libColl.key,
            name: libColl.libraryName + ' / ' + libColl.name,
            isLibrary: true,
            libraryName: libColl.libraryName
          });

          // Process each library variable
          for (var lv = 0; lv < libVars.length; lv++) {
            var libVar = libVars[lv];

            // Import the variable to get full access
            try {
              var importedVar = await figma.variables.importVariableByKeyAsync(libVar.key);

              // Check for GAP, WIDTH_HEIGHT, or ALL_SCOPES (default when designer hasn't set specific scopes)
              if (!importedVar.scopes || (importedVar.scopes.indexOf('GAP') === -1 && importedVar.scopes.indexOf('WIDTH_HEIGHT') === -1 && importedVar.scopes.indexOf('ALL_SCOPES') === -1)) {
                continue;
              }
              // If ALL_SCOPES, only include FLOAT variables (numbers that could be spacing)
              if (importedVar.scopes.indexOf('GAP') === -1 && importedVar.scopes.indexOf('WIDTH_HEIGHT') === -1 && importedVar.scopes.indexOf('ALL_SCOPES') !== -1) {
                if (importedVar.resolvedType !== 'FLOAT') {
                  continue;
                }
              }

              console.log('Found library spacing variable:', importedVar.name);

              // Get the variable's numeric value (handles aliases)
              var numericValue = null;
              try {
                var varCollection = await figma.variables.getVariableCollectionByIdAsync(importedVar.variableCollectionId);
                if (varCollection && varCollection.modes && varCollection.modes.length > 0) {
                  var defaultMode = varCollection.modes[0];
                  // Use resolver to handle both direct values and aliases
                  numericValue = await resolveVariableValue(importedVar, defaultMode.modeId);
                }
              } catch (e) {
                console.log('Error getting value for library variable', importedVar.name, ':', e.message);
              }

              if (numericValue !== null) {
                spacingVariables.push({
                  id: importedVar.id,
                  name: importedVar.name,
                  value: numericValue,
                  variable: importedVar,
                  scopes: importedVar.scopes,
                  collectionId: libColl.key,
                  collectionName: libColl.libraryName + ' / ' + libColl.name,
                  isLibrary: true
                });
              }
            } catch (importErr) {
              console.log('Error importing library variable:', libVar.name, importErr.message);
            }
          }
        } catch (libVarsErr) {
          console.log('Error getting variables from library collection:', libColl.name, libVarsErr.message);
        }
      }
    } catch (libErr) {
      console.log('Error getting library collections:', libErr.message);
    }

    var localVariables = await figma.variables.getLocalVariablesAsync();
    console.log('Found', localVariables.length, 'total local variables');

    for (var i = 0; i < localVariables.length; i++) {
      var variable = localVariables[i];

      // Check for GAP, WIDTH_HEIGHT, or ALL_SCOPES (default when designer hasn't set specific scopes)
      var hasGap = variable.scopes && variable.scopes.indexOf('GAP') !== -1;
      var hasWidthHeight = variable.scopes && variable.scopes.indexOf('WIDTH_HEIGHT') !== -1;
      var hasAllScopes = variable.scopes && variable.scopes.indexOf('ALL_SCOPES') !== -1;

      if (!variable.scopes || (!hasGap && !hasWidthHeight && !hasAllScopes)) {
        continue;
      }

      // If only ALL_SCOPES (no specific spacing scopes), only include FLOAT variables
      if (!hasGap && !hasWidthHeight && hasAllScopes) {
        if (variable.resolvedType !== 'FLOAT') {
          continue;
        }
      }

      console.log('Found spacing variable:', variable.name);

      // Get the variable's numeric value and collection info
      var numericValue = null;
      var collectionName = '';
      var collectionId = variable.variableCollectionId;
      try {
        var collection = collectionMap[collectionId];
        if (collection) {
          collectionName = collection.name;
          if (collection.modes && collection.modes.length > 0) {
            var defaultMode = collection.modes[0];
            // Use resolver to handle both direct values and aliases
            numericValue = await resolveVariableValue(variable, defaultMode.modeId);
          }
        }
      } catch (e) {
        console.log('Error getting value for variable', variable.name, ':', e.message);
      }

      if (numericValue !== null) {
        spacingVariables.push({
          id: variable.id,
          name: variable.name,
          value: numericValue,
          variable: variable,
          scopes: variable.scopes,
          collectionId: collectionId,
          collectionName: collectionName,
          isLibrary: false
        });
      }
    }

    // Sort variables by their numeric value
    spacingVariables.sort(function(a, b) {
      return a.value - b.value;
    });

    console.log('Found', spacingVariables.length, 'spacing variables with values');

    figma.ui.postMessage({
      type: 'variables-found',
      variables: spacingVariables.map(function(v) {
        return {
          id: v.id,
          name: v.name,
          value: v.value,
          scopes: v.scopes,
          collectionId: v.collectionId,
          collectionName: v.collectionName
        };
      })
    });
    sendCollectionsToUI();

  } catch (e) {
    console.log('Error scanning variables:', e.message);
    figma.ui.postMessage({
      type: 'variables-found',
      variables: [],
      error: e.message
    });
    figma.ui.postMessage({
      type: 'collections-found',
      collections: [],
      selectedCollectionIds: []
    });
  }
}

// Find matching variable for a given spacing value, preferring earlier-ranked collections
function findMatchingVariable(spacingValue, propertyType) {
  var candidates = [];
  for (var i = 0; i < spacingVariables.length; i++) {
    var variable = spacingVariables[i];

    // Skip if collections filter is active and this variable isn't in the set
    if (selectedCollectionIds.length > 0 && selectedCollectionIds.indexOf(variable.collectionId) === -1) {
      continue;
    }

    if (variable.value !== spacingValue) continue;

    var hasGapScope = variable.scopes.indexOf('GAP') !== -1;
    var hasWidthHeightScope = variable.scopes.indexOf('WIDTH_HEIGHT') !== -1;

    var scopeMatch = 2; // 0 = exact scope, 1 = compatible, 2 = loose
    if (propertyType === 'gap' && hasGapScope) scopeMatch = 0;
    else if (propertyType === 'padding' && hasWidthHeightScope) scopeMatch = 0;
    else if (hasGapScope || hasWidthHeightScope) scopeMatch = 1;
    else continue;

    var rank = selectedCollectionIds.indexOf(variable.collectionId);
    if (rank === -1) rank = Number.MAX_SAFE_INTEGER;

    candidates.push({ variable: variable, scopeMatch: scopeMatch, rank: rank });
  }

  if (candidates.length === 0) return null;

  candidates.sort(function(a, b) {
    if (a.scopeMatch !== b.scopeMatch) return a.scopeMatch - b.scopeMatch;
    return a.rank - b.rank;
  });
  return candidates[0].variable;
}

// Get detailed spacing information from a node
function getDetailedSpacingInfo(node) {
  // Helper function to safely get numeric value or return null for symbols
  function getNumericValue(value) {
    if (value === undefined || value === null) {
      return null;
    }

    // Check if it's a symbol (bound variable)
    if (typeof value === 'symbol') {
      return 'variable';
    }

    // Check if it's already a number
    if (typeof value === 'number') {
      return value;
    }

    // Try to convert to number if it's a string
    if (typeof value === 'string') {
      var num = parseFloat(value);
      return !isNaN(num) ? num : null;
    }

    return null;
  }

  var spacingInfo = {
    itemSpacing: getNumericValue(node.itemSpacing),
    counterAxisSpacing: getNumericValue(node.counterAxisSpacing),
    paddingTop: getNumericValue(node.paddingTop),
    paddingRight: getNumericValue(node.paddingRight),
    paddingBottom: getNumericValue(node.paddingBottom),
    paddingLeft: getNumericValue(node.paddingLeft),
    hasIndividualPadding: false,
    hasVariables: false,
    primaryLayoutMode: node.primaryAxisAlignItems ? 'auto-layout' : 'none'
  };

  // Check if using individual padding values
  var individualPadding = [spacingInfo.paddingTop, spacingInfo.paddingRight, spacingInfo.paddingBottom, spacingInfo.paddingLeft];
  var hasNonZeroIndividual = false;
  var hasVariableIndividual = false;

  for (var i = 0; i < individualPadding.length; i++) {
    if (individualPadding[i] === 'variable') {
      hasVariableIndividual = true;
      spacingInfo.hasVariables = true;
    } else if (individualPadding[i] !== null && individualPadding[i] > 0) {
      hasNonZeroIndividual = true;
    }
  }

  // Check if gap has variable
  if (spacingInfo.itemSpacing === 'variable' || spacingInfo.counterAxisSpacing === 'variable') {
    spacingInfo.hasVariables = true;
  }

  spacingInfo.hasIndividualPadding = hasNonZeroIndividual || hasVariableIndividual;

  return spacingInfo;
}

// ---------------------------------------------------------------------------
// Node scanning - iterative (not recursive) so it can yield to the UI thread
// periodically on very large pages/selections instead of freezing Figma.
// ---------------------------------------------------------------------------
function shouldSkipNode(node) {
  // Always ignore COMPONENT_SET layers (component variants) themselves,
  // but their children are still traversed (handled by the caller).
  if (node.type === 'COMPONENT_SET') return true;

  for (var k = 0; k < ignoredLayerNames.length; k++) {
    if (node.name === ignoredLayerNames[k]) return true;
  }
  return false;
}

function processNode(node, results) {
  try {
    var hasCounterAxisSpacing = node.layoutWrap === 'WRAP' && node.counterAxisSpacing !== undefined;
    var hasAutoLayoutSpacing = (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL') &&
                               (node.itemSpacing !== undefined || hasCounterAxisSpacing);
    var hasPadding = node.paddingTop !== undefined ||
                     node.paddingRight !== undefined ||
                     node.paddingBottom !== undefined ||
                     node.paddingLeft !== undefined;

    if (!hasAutoLayoutSpacing && !hasPadding) return;

    var spacingInfo = getDetailedSpacingInfo(node);
    var spacingIssues = [];

    // Skip gap check if using auto-spacing (SPACE_BETWEEN)
    var isAutoSpaced = node.primaryAxisAlignItems === 'SPACE_BETWEEN';
    var hasAutoLayout = node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL';

    if (hasAutoLayout && !isAutoSpaced && spacingInfo.itemSpacing !== null && spacingInfo.itemSpacing !== 'variable' && spacingInfo.itemSpacing > 0) {
      spacingIssues.push({ type: 'gap', value: spacingInfo.itemSpacing, property: 'itemSpacing' });
    }

    // counterAxisSpacing (cross-axis gap for wrapped auto-layout); null means it syncs with itemSpacing
    if (hasAutoLayout && node.layoutWrap === 'WRAP' && spacingInfo.counterAxisSpacing !== null && spacingInfo.counterAxisSpacing !== 'variable' && spacingInfo.counterAxisSpacing > 0) {
      spacingIssues.push({ type: 'gap', value: spacingInfo.counterAxisSpacing, property: 'counterAxisSpacing' });
    }

    if (spacingInfo.hasIndividualPadding) {
      var paddingProps = [
        { prop: 'paddingTop', value: spacingInfo.paddingTop },
        { prop: 'paddingRight', value: spacingInfo.paddingRight },
        { prop: 'paddingBottom', value: spacingInfo.paddingBottom },
        { prop: 'paddingLeft', value: spacingInfo.paddingLeft }
      ];

      for (var p = 0; p < paddingProps.length; p++) {
        if (paddingProps[p].value !== null && paddingProps[p].value !== 'variable' && paddingProps[p].value > 0) {
          spacingIssues.push({ type: 'padding', value: paddingProps[p].value, property: paddingProps[p].prop });
        }
      }
    }

    for (var s = 0; s < spacingIssues.length; s++) {
      var issue = spacingIssues[s];
      var matchingVariable = findMatchingVariable(issue.value, issue.type);
      var issueType = null;
      var suggestion = null;

      var hasPropertyVariable = false;
      try {
        if (node.boundVariables && node.boundVariables[issue.property]) {
          hasPropertyVariable = true;
        }
      } catch (e) {
        console.log('Error checking bound variable for', issue.property + ':', e.message);
      }

      if (!hasPropertyVariable && matchingVariable) {
        issueType = 'missing_variable';
        suggestion = {
          type: 'apply_variable',
          variable: matchingVariable,
          message: 'Apply ' + matchingVariable.name + ' (' + matchingVariable.value + 'px) to ' + issue.property,
          property: issue.property,
          propertyType: issue.type
        };
      } else if (!hasPropertyVariable && !matchingVariable) {
        issueType = 'no_matching_variable';
        suggestion = {
          type: 'no_suggestion',
          message: 'No matching variable for ' + issue.value + 'px in ' + issue.property,
          property: issue.property,
          propertyType: issue.type
        };
      } else if (hasPropertyVariable) {
        issueType = 'has_variable';
        suggestion = {
          type: 'already_fixed',
          message: 'Already using variable for ' + issue.property
        };
      }

      if (issueType) {
        results.push({
          id: node.id,
          name: node.name,
          type: node.type,
          spacingValue: issue.value,
          spacingProperty: issue.property,
          propertyType: issue.type,
          hasVariable: hasPropertyVariable,
          issueType: issueType,
          matchingVariable: matchingVariable,
          suggestion: suggestion,
          spacingInfo: spacingInfo
        });
      }
    }
  } catch (e) {
    console.log('Error processing node', node.name + ':', e.message);
  }
}

// Iterative (stack-based) traversal so we can yield control back to Figma's
// UI thread every so often instead of doing one giant synchronous walk -
// this is what keeps the plugin responsive on very large pages/selections.
async function scanNodesAsync(rootNodes, gen) {
  var results = [];
  var stack = [];
  for (var i = rootNodes.length - 1; i >= 0; i--) stack.push(rootNodes[i]);

  var visited = 0;
  while (stack.length > 0) {
    if (isStale(gen)) return { results: results, cancelled: true };

    var node = stack.pop();
    visited++;

    var skip = false;
    try { skip = shouldSkipNode(node); } catch (e) {}
    if (!skip) {
      processNode(node, results);
    }

    try {
      if ('children' in node) {
        var children = node.children;
        for (var c = children.length - 1; c >= 0; c--) stack.push(children[c]);
      }
    } catch (e) {
      console.log('Error reading children of', node.name || 'unknown', ':', e.message);
    }

    if (visited % 400 === 0) {
      await nextTick();
    }
  }

  return { results: results, cancelled: false };
}

function mapLayerForUI(layer) {
  return {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    spacingValue: layer.spacingValue,
    spacingProperty: layer.spacingProperty,
    hasVariable: layer.hasVariable,
    issueType: layer.issueType,
    suggestion: layer.suggestion
  };
}

// ---------------------------------------------------------------------------
// Scan entry points
// ---------------------------------------------------------------------------
async function scanSelection() {
  var gen = beginRun();
  figma.ui.postMessage({ type: 'scan-started', scope: 'selection' });

  var selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'error', message: 'Please select one or more layers to scan' });
    return;
  }

  var scan = await scanNodesAsync(selection, gen);
  if (isStale(gen)) return;

  currentView = { kind: 'selection', pageId: null };
  currentViewLayers = scan.results;

  figma.ui.postMessage({
    type: 'selection-report',
    layers: scan.results.map(mapLayerForUI),
    totalLayers: scan.results.length
  });
}

function findPageStub(pageId) {
  var pages = figma.root.children;
  for (var i = 0; i < pages.length; i++) {
    if (pages[i].id === pageId) return pages[i];
  }
  return null;
}

// Scans a single page, reusing the cached report when nothing that would
// affect the result has changed since we last scanned it THIS session.
async function scanPage(pageId, force) {
  var gen = beginRun();
  var page = findPageStub(pageId);
  if (!page) {
    figma.ui.postMessage({ type: 'error', message: 'Page no longer exists' });
    return;
  }

  figma.ui.postMessage({ type: 'scan-started', scope: 'page', pageId: pageId });

  if (!force && pageReports[pageId] && scannedThisSession[pageId] && !dirtyPages[pageId]) {
    var idx = readIndex();
    var existingEntry = idx.pages[pageId];
    if (existingEntry && existingEntry.paramsKey === computeParamsKey()) {
      currentView = { kind: 'page', pageId: pageId };
      currentViewLayers = pageReports[pageId];
      figma.ui.postMessage({
        type: 'page-report',
        pageId: pageId,
        pageName: page.name,
        layers: pageReports[pageId].map(mapLayerForUI),
        totalLayers: pageReports[pageId].length,
        cached: true,
        scannedAt: existingEntry.scannedAt
      });
      return;
    }
  }

  try {
    await page.loadAsync();
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: 'Failed to load page: ' + e.message });
    return;
  }
  watchPage(page);

  var scan = await scanNodesAsync(page.children, gen);
  if (isStale(gen)) return;

  pageNames[pageId] = page.name;
  pageReports[pageId] = scan.results;
  scannedThisSession[pageId] = true;
  dirtyPages[pageId] = false;

  var entry = entryFromLayers(page.name, scan.results);
  setIndexEntry(pageId, entry);

  currentView = { kind: 'page', pageId: pageId };
  currentViewLayers = scan.results;

  figma.ui.postMessage({ type: 'page-scanned', pageId: pageId, entry: entry });
  figma.ui.postMessage({
    type: 'page-report',
    pageId: pageId,
    pageName: page.name,
    layers: scan.results.map(mapLayerForUI),
    totalLayers: scan.results.length,
    cached: false,
    scannedAt: entry.scannedAt
  });
}

// Navigates the canvas to a page and shows its scan results (sidebar click).
async function selectPage(pageId, force) {
  try {
    var page = findPageStub(pageId);
    if (page && figma.currentPage.id !== pageId) {
      await figma.setCurrentPageAsync(page); // triggers 'currentpagechange', which notifies the UI
    }
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: 'Failed to switch page: ' + e.message });
    return;
  }
  await scanPage(pageId, force);
}

// Scans every page in the file. Pages that were already scanned THIS session,
// aren't dirty, and were scanned under the same settings are skipped entirely
// (not even loaded) - this is what makes re-running "Scan Entire File" fast
// after the first pass, since only pages you actually touched get rescanned.
async function scanAll(force) {
  var gen = beginRun();
  figma.ui.postMessage({ type: 'scan-started', scope: 'all' });

  var pages = realPages();
  var key = computeParamsKey();
  var index = readIndex();

  var queue = [];
  var skipped = 0;
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    var entry = index.pages[p.id];
    var isClean = !force && scannedThisSession[p.id] && !dirtyPages[p.id] && entry && entry.paramsKey === key;
    if (isClean) skipped++;
    else queue.push(p);
  }

  figma.ui.postMessage({ type: 'scan-all-started', total: queue.length, skipped: skipped });

  for (var q = 0; q < queue.length; q++) {
    if (isStale(gen)) return;

    var page = queue[q];
    try {
      await page.loadAsync();
    } catch (e) {
      console.log('Error loading page', page.name, ':', e.message);
      continue;
    }
    watchPage(page);

    var scan = await scanNodesAsync(page.children, gen);
    if (isStale(gen)) return;

    pageNames[page.id] = page.name;
    pageReports[page.id] = scan.results;
    scannedThisSession[page.id] = true;
    dirtyPages[page.id] = false;

    var pageEntry = entryFromLayers(page.name, scan.results);
    setIndexEntry(page.id, pageEntry);

    figma.ui.postMessage({ type: 'page-scanned', pageId: page.id, entry: pageEntry });
    figma.ui.postMessage({ type: 'scan-all-progress', current: q + 1, total: queue.length, pageName: page.name });
  }

  if (isStale(gen)) return;

  var finalIndex = readIndex();
  var pageResults = pages.map(function(p) {
    var e = finalIndex.pages[p.id];
    if (e) {
      return { id: p.id, name: p.name, total: e.total, fixable: e.fixable, componentFixable: e.componentFixable, noMatch: e.noMatch, alreadyFixed: e.alreadyFixed, problems: e.problems, scannedAt: e.scannedAt, dirty: e.dirty };
    }
    return { id: p.id, name: p.name, total: 0, fixable: 0, componentFixable: 0, noMatch: 0, alreadyFixed: 0, problems: 0, scannedAt: null, dirty: false };
  });
  pageResults.sort(function(a, b) { return b.problems - a.problems; });

  figma.ui.postMessage({ type: 'scan-all-complete', pages: pageResults, scannedAt: Date.now(), skipped: skipped });
}

async function clearFileScan() {
  writeIndex({ pages: {} });
  pageReports = {};
  scannedThisSession = {};
  dirtyPages = {};
  sendPagesSnapshot();
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
async function navigateToLayer(layerId) {
  var layerInfo = null;
  for (var i = 0; i < currentViewLayers.length; i++) {
    if (currentViewLayers[i].id === layerId) {
      layerInfo = currentViewLayers[i];
      break;
    }
  }
  if (!layerInfo) return;

  var node = await figma.getNodeByIdAsync(layerId);
  if (!node) {
    figma.ui.postMessage({ type: 'error', message: 'Layer no longer exists' });
    return;
  }

  if (currentView.kind === 'page' && currentView.pageId && figma.currentPage.id !== currentView.pageId) {
    try {
      var targetPage = findPageStub(currentView.pageId);
      if (targetPage) await figma.setCurrentPageAsync(targetPage);
    } catch (e) {
      console.log('Error switching to layer\'s page:', e.message);
    }
  }

  figma.viewport.scrollAndZoomIntoView([node]);
  figma.currentPage.selection = [node];

  figma.ui.postMessage({ type: 'layer-selected', layer: mapLayerForUI(layerInfo) });
}

// ---------------------------------------------------------------------------
// Applying variables
// ---------------------------------------------------------------------------
function applyVariableToProperty(node, variable, propertyName) {
  if (propertyName === 'itemSpacing') {
    node.setBoundVariable('itemSpacing', variable);
  } else if (propertyName === 'counterAxisSpacing') {
    node.setBoundVariable('counterAxisSpacing', variable);
  } else if (propertyName === 'horizontalPadding') {
    node.setBoundVariable('paddingLeft', variable);
    node.setBoundVariable('paddingRight', variable);
  } else if (propertyName === 'verticalPadding') {
    node.setBoundVariable('paddingTop', variable);
    node.setBoundVariable('paddingBottom', variable);
  } else if (propertyName === 'paddingTop' || propertyName === 'paddingRight' || propertyName === 'paddingBottom' || propertyName === 'paddingLeft') {
    node.setBoundVariable(propertyName, variable);
  }
}

function updateLayerInCurrentView(layerId) {
  for (var i = 0; i < currentViewLayers.length; i++) {
    if (currentViewLayers[i].id === layerId) {
      currentViewLayers[i].hasVariable = true;
      currentViewLayers[i].issueType = 'has_variable';
      currentViewLayers[i].suggestion = { type: 'already_fixed', message: 'Already using variable' };
      break;
    }
  }
}

// Recomputes and persists the page-level badge counts after fixes are applied,
// so the sidebar reflects progress without requiring a full rescan.
function persistCurrentPageCounts() {
  if (currentView.kind !== 'page' || !currentView.pageId) return;
  var pageId = currentView.pageId;
  var layers = pageReports[pageId];
  if (!layers) return;
  var entry = entryFromLayers(pageNames[pageId] || 'Page', layers);
  setIndexEntry(pageId, entry);
  figma.ui.postMessage({ type: 'page-scanned', pageId: pageId, entry: entry });
}

async function applyVariableToLayer(layerId, variableId, propertyName) {
  var node = await figma.getNodeByIdAsync(layerId);
  if (!node) {
    figma.ui.postMessage({ type: 'error', message: 'Layer no longer exists' });
    return;
  }

  try {
    var variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) {
      figma.ui.postMessage({ type: 'error', message: 'Variable no longer exists' });
      return;
    }

    isApplying = true;
    try {
      applyVariableToProperty(node, variable, propertyName);
    } finally {
      await nextTick();
      isApplying = false;
    }

    updateLayerInCurrentView(layerId);
    persistCurrentPageCounts();

    figma.ui.postMessage({
      type: 'variable-applied',
      variableName: variable.name + (propertyName ? ' to ' + propertyName : ''),
      layerName: node.name,
      layerId: layerId
    });

  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: 'Failed to apply variable: ' + e.message });
  }
}

// Applies variables to every fixable layer in the currently displayed view
// (selection or single page).
async function autofixAllLayers() {
  var currentLayers = currentViewLayers.slice();
  var fixedLayers = [];
  var failedLayers = [];

  isApplying = true;
  try {
    for (var i = 0; i < currentLayers.length; i++) {
      var layer = currentLayers[i];

      if (layer.issueType !== 'missing_variable' || !layer.suggestion || layer.suggestion.type !== 'apply_variable') {
        continue;
      }

      try {
        var node = await figma.getNodeByIdAsync(layer.id);
        if (!node) {
          failedLayers.push({ layerName: layer.name, reason: 'Layer not found' });
          continue;
        }

        var variable = await figma.variables.getVariableByIdAsync(layer.suggestion.variable.id);
        if (!variable) {
          failedLayers.push({ layerName: layer.name, reason: 'Variable not found' });
          continue;
        }

        var propertyName = layer.suggestion.property || layer.spacingProperty;
        applyVariableToProperty(node, variable, propertyName);
        updateLayerInCurrentView(layer.id);

        fixedLayers.push({ layerName: layer.name, variableName: variable.name, property: propertyName });
      } catch (error) {
        console.error('Error fixing layer:', layer.name, error);
        failedLayers.push({ layerName: layer.name, reason: error.message });
      }
    }
  } finally {
    await nextTick();
    isApplying = false;
  }

  persistCurrentPageCounts();

  figma.ui.postMessage({
    type: 'autofix-complete',
    fixedLayers: fixedLayers,
    failedLayers: failedLayers,
    totalFixed: fixedLayers.length,
    totalFailed: failedLayers.length
  });
}

// Pages whose name starts with "Pro blocks" (e.g. "Pro blocks - Applications")
// are large pre-assembled example compositions built from instances of the
// kit's components - as opposed to a component's own page, which mixes the
// actual component definitions with small "local" usage-example instances
// sitting right beside them. Harmless no-op on files without any such pages
// (everything just falls into the 'local' pass).
var PRO_BLOCKS_PAGE_PATTERN = /^pro\s*blocks\b/i;
function isProBlocksPage(name) {
  return PRO_BLOCKS_PAGE_PATTERN.test(name || '');
}

// Gathers every currently-fixable layer across all in-memory page reports
// that matches `predicate(layer, pageId)`. Called fresh at the start of each
// pass (not once upfront) so later passes see the results of earlier ones.
function collectFixableJobs(predicate) {
  var jobs = [];
  var pageIds = Object.keys(pageReports);
  for (var pi = 0; pi < pageIds.length; pi++) {
    var pageId = pageIds[pi];
    var layers = pageReports[pageId];
    if (!layers) continue;
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (layer.issueType !== 'missing_variable' || !layer.suggestion || layer.suggestion.type !== 'apply_variable') continue;
      if (predicate(layer, pageId)) jobs.push({ pageId: pageId, layer: layer });
    }
  }
  return jobs;
}

async function applyFixJobs(jobs, onProgress) {
  var touchedPages = {};
  var fixed = 0;
  var failed = [];

  for (var j = 0; j < jobs.length; j++) {
    var job = jobs[j];
    var layer = job.layer;

    try {
      var node = await figma.getNodeByIdAsync(layer.id);
      if (!node) {
        failed.push({ layerName: layer.name, reason: 'Layer not found' });
        continue;
      }

      var variable = await figma.variables.getVariableByIdAsync(layer.suggestion.variable.id);
      if (!variable) {
        failed.push({ layerName: layer.name, reason: 'Variable not found' });
        continue;
      }

      var propertyName = layer.suggestion.property || layer.spacingProperty;
      applyVariableToProperty(node, variable, propertyName);

      layer.hasVariable = true;
      layer.issueType = 'has_variable';
      layer.suggestion = { type: 'already_fixed', message: 'Already using variable' };

      touchedPages[job.pageId] = true;
      fixed++;
    } catch (e) {
      console.error('Error fixing layer:', layer.name, e);
      failed.push({ layerName: layer.name, reason: e.message });
    }

    if (onProgress && (j % 20 === 0 || j === jobs.length - 1)) {
      onProgress(j + 1, jobs.length);
    }
  }

  return { touchedPages: touchedPages, fixed: fixed, failed: failed };
}

// Re-walks specific pages right after fixing them, before the next pass
// reads from pageReports again. Fixing a component can change what an
// unrelated, not-yet-processed instance now reads as (whether it still
// needs its own fix at all) in ways this plugin doesn't control - rescanning
// keeps every later pass working from ground truth instead of a pre-fix
// snapshot, and keeps sidebar badges accurate as we go.
async function rescanPages(pageIds, gen) {
  for (var i = 0; i < pageIds.length; i++) {
    var pageId = pageIds[i];
    var page = findPageStub(pageId);
    if (!page) continue;

    try {
      await page.loadAsync();
    } catch (e) {
      continue;
    }

    var scan = await scanNodesAsync(page.children, gen);
    if (isStale(gen)) return;

    pageReports[pageId] = scan.results;
    var entry = entryFromLayers(page.name, scan.results);
    setIndexEntry(pageId, entry);
    figma.ui.postMessage({ type: 'page-scanned', pageId: pageId, entry: entry });
  }
}

// Applies every fixable suggestion across every page that's been scanned
// (in memory this session), in three safe passes, rescanning touched pages
// between each so the next pass always works from current data:
//   1. Components - fixing a component benefits every instance of it, so
//      this is the highest-leverage, lowest-risk pass. Component-set
//      variants are individually typed 'COMPONENT' in Figma's API (the
//      COMPONENT_SET wrapper itself never shows up as a result), so they're
//      naturally included here alongside standalone components.
//   2. Everything else "local" to a component's own page (e.g. small
//      usage-example instances sitting beside the component definition) -
//      still low blast-radius, and most likely to have already inherited
//      cleanly from pass 1.
//   3. "Pro Blocks" pages - large example compositions assembled from many
//      component instances; by far the biggest blast radius, so these run
//      last, after everything they're built from is already fixed.
async function autofixFile() {
  if (Object.keys(pageReports).length === 0) {
    figma.ui.postMessage({ type: 'error', message: 'Scan the whole file first, then Fix All.' });
    return;
  }

  var gen = beginRun();

  var upfrontTotal = collectFixableJobs(function() { return true; }).length;
  if (upfrontTotal === 0) {
    figma.ui.postMessage({ type: 'error', message: 'Nothing to fix.' });
    return;
  }

  var scannedPageCount = Object.keys(pageReports).length;

  // Snapshot the file's version history before making bulk changes, so
  // there's an explicit restore point beyond Figma's regular undo stack -
  // useful since undo history can get lost if the tab/file is closed.
  var snapshotOk = false;
  var snapshotError = null;
  try {
    await figma.saveVersionHistoryAsync(
      'Before spacing autofix',
      'Saved automatically by Obra Spacing Variable Fixer before applying up to ' + upfrontTotal + ' spacing fix' + (upfrontTotal === 1 ? '' : 'es') + ' across ' + scannedPageCount + ' page' + (scannedPageCount === 1 ? '' : 's') + '.'
    );
    snapshotOk = true;
  } catch (e) {
    snapshotError = e.message;
    console.log('Error saving version history snapshot:', e.message);
  }

  figma.ui.postMessage({ type: 'autofix-file-started', total: upfrontTotal, snapshotOk: snapshotOk, snapshotError: snapshotError });

  var passes = [
    { phase: 'components', predicate: function(layer) { return layer.type === 'COMPONENT'; } },
    { phase: 'local', predicate: function(layer, pageId) { return layer.type !== 'COMPONENT' && !isProBlocksPage(pageNames[pageId]); } },
    { phase: 'pro-blocks', predicate: function(layer, pageId) { return layer.type !== 'COMPONENT' && isProBlocksPage(pageNames[pageId]); } }
  ];

  var totalFixed = 0;
  var failedLayers = [];
  var touchedPages = {};

  isApplying = true;
  try {
    for (var p = 0; p < passes.length; p++) {
      if (isStale(gen)) break;

      var pass = passes[p];
      var jobs = collectFixableJobs(pass.predicate);
      if (jobs.length === 0) continue;

      figma.ui.postMessage({ type: 'autofix-file-pass-started', phase: pass.phase, total: jobs.length });

      var result = await applyFixJobs(jobs, (function(phase) {
        return function(current, total) {
          figma.ui.postMessage({ type: 'autofix-file-progress', phase: phase, current: current, total: total });
        };
      })(pass.phase));

      totalFixed += result.fixed;
      failedLayers = failedLayers.concat(result.failed);

      var touchedThisPass = Object.keys(result.touchedPages);
      for (var tp = 0; tp < touchedThisPass.length; tp++) touchedPages[touchedThisPass[tp]] = true;

      if (isStale(gen)) break;

      if (touchedThisPass.length > 0) {
        figma.ui.postMessage({ type: 'autofix-file-rescanning', phase: pass.phase, pageCount: touchedThisPass.length });
        await rescanPages(touchedThisPass, gen);
      }
    }
  } finally {
    await nextTick();
    isApplying = false;
  }

  var touchedPageIds = Object.keys(touchedPages);

  // If the currently-open page view was touched, refresh it in place so the
  // user sees the fixes without having to manually rescan.
  if (currentView.kind === 'page' && currentView.pageId && touchedPages[currentView.pageId]) {
    var currentReport = pageReports[currentView.pageId];
    figma.ui.postMessage({
      type: 'page-report',
      pageId: currentView.pageId,
      pageName: pageNames[currentView.pageId] || '',
      layers: currentReport.map(mapLayerForUI),
      totalLayers: currentReport.length,
      cached: true,
      scannedAt: Date.now()
    });
  }

  figma.ui.postMessage({
    type: 'autofix-file-complete',
    totalFixed: totalFixed,
    totalFailed: failedLayers.length,
    totalPages: touchedPageIds.length,
    failedLayers: failedLayers
  });
}

// ---------------------------------------------------------------------------
// Ignored layer names (persisted per-user via clientStorage)
// ---------------------------------------------------------------------------
async function loadIgnoredNames() {
  try {
    var savedNames = await figma.clientStorage.getAsync('spacingChecker_ignoredNames');
    if (savedNames) {
      ignoredLayerNames = savedNames;
    } else {
      ignoredLayerNames = ['Labels', 'Label', 'Bracket', 'Instances', 'Instance'];
      await figma.clientStorage.setAsync('spacingChecker_ignoredNames', ignoredLayerNames);
    }
  } catch (e) {
    console.log('Error loading ignored names:', e);
  }
  figma.ui.postMessage({ type: 'ignored-names-loaded', ignoredNames: ignoredLayerNames });
}

async function saveIgnoredNames(names) {
  ignoredLayerNames = names || [];
  try {
    await figma.clientStorage.setAsync('spacingChecker_ignoredNames', ignoredLayerNames);
  } catch (e) {
    console.log('Error saving ignored names:', e);
  }
}

// ---------------------------------------------------------------------------
// Variable collections (persisted per-user via clientStorage)
// ---------------------------------------------------------------------------
async function loadSelectedCollections() {
  try {
    var savedCollections = await figma.clientStorage.getAsync('spacingChecker_selectedCollections');
    if (savedCollections && Array.isArray(savedCollections)) {
      selectedCollectionIds = savedCollections;
      console.log('Loaded selected collections from clientStorage:', selectedCollectionIds);
    }
  } catch (e) {
    console.log('Error loading selected collections:', e);
  }
}

async function saveSelectedCollections(collectionIds) {
  try {
    await figma.clientStorage.setAsync('spacingChecker_selectedCollections', collectionIds);
  } catch (e) {
    console.log('Error saving selected collections:', e);
  }
}

function setSelectedCollections(collectionIds) {
  selectedCollectionIds = collectionIds || [];
  saveSelectedCollections(selectedCollectionIds);
  sendCollectionsToUI();
}

function sendCollectionsToUI() {
  // Count variables per collection
  var counts = {};
  for (var i = 0; i < spacingVariables.length; i++) {
    var id = spacingVariables[i].collectionId;
    counts[id] = (counts[id] || 0) + 1;
  }
  var collectionsWithCounts = variableCollections
    .map(function(c) {
      return {
        id: c.id,
        name: c.name,
        isLibrary: !!c.isLibrary,
        variableCount: counts[c.id] || 0
      };
    })
    .filter(function(c) { return c.variableCount > 0; });

  figma.ui.postMessage({
    type: 'collections-found',
    collections: collectionsWithCounts,
    selectedCollectionIds: selectedCollectionIds
  });
}

// ---------------------------------------------------------------------------
// Messages from UI
// ---------------------------------------------------------------------------
figma.ui.onmessage = async function(msg) {
  console.log('Received message:', msg.type);

  switch (msg.type) {
    case 'scan-selection':
      await scanSelection();
      break;

    case 'select-page':
      await selectPage(msg.pageId, !!msg.force);
      break;

    case 'scan-page':
      await scanPage(msg.pageId || figma.currentPage.id, !!msg.force);
      break;

    case 'scan-all':
      await scanAll(!!msg.force);
      break;

    case 'cancel-scan':
      cancelScan();
      break;

    case 'navigate-to-layer':
      await navigateToLayer(msg.layerId);
      break;

    case 'apply-variable':
      await applyVariableToLayer(msg.layerId, msg.variableId, msg.propertyName);
      break;

    case 'autofix-all':
      await autofixAllLayers();
      break;

    case 'autofix-file':
      await autofixFile();
      break;

    case 'rescan-variables':
      await scanForSpacingVariables();
      break;

    case 'select-collections':
      setSelectedCollections(msg.collectionIds);
      break;

    case 'save-ignored-names':
      await saveIgnoredNames(msg.ignoredNames);
      break;

    case 'load-ignored-names':
      await loadIgnoredNames();
      break;

    case 'clear-file-scan':
      await clearFileScan();
      break;

    case 'close':
      figma.closePlugin();
      break;
  }
};
