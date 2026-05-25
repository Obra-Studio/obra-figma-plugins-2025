figma.showUI(__html__, { width: 420, height: 600 });

let librariesFound = [];
let foundElements = []; // Store actual elements with node references
let scanCancelled = false;
let currentScanId = null;
let currentScanType = null;

// Performance constants
const BATCH_SIZE = 50; // Process nodes in batches
const BATCH_DELAY = 10; // ms delay between batches

// Cache for local resources (reset on each scan)
let cachedLocalVariables = null;
let cachedLocalStyles = null;
let cachedLocalComponents = null;

// Clear cache before new operations. Not called automatically by scans —
// the cache survives across scans and is rebuilt only by an explicit refresh
// (UI: "Refresh Local Index"). See refreshLocalCache.
function clearLocalCache() {
  cachedLocalVariables = null;
  cachedLocalStyles = null;
  cachedLocalComponents = null;
}

async function localCacheCounts() {
  return {
    components: cachedLocalComponents ? cachedLocalComponents.length : null,
    variables: cachedLocalVariables ? cachedLocalVariables.length : null,
    fillStyles: cachedLocalStyles ? cachedLocalStyles.fillStyles.length : null,
    textStyles: cachedLocalStyles ? cachedLocalStyles.textStyles.length : null,
    effectStyles: cachedLocalStyles ? cachedLocalStyles.effectStyles.length : null
  };
}

async function refreshLocalCache() {
  clearLocalCache();
  await figma.loadAllPagesAsync();
  // Force-populate all three caches
  await getLocalStyles();
  await getLocalVariables();
  await getLocalComponents();
  return localCacheCounts();
}

// Best-effort label for a remote item's source library. The plugin API doesn't
// expose the source library name (BaseStyle.remote / Variable.remote /
// ComponentNode.remote are all booleans), so we approximate:
//   - variable → its VariableCollection name (e.g. "Primitives")
//   - style / component → first segment of the slash-separated name path
async function remoteLibraryLabel(kind, item) {
  if (kind === 'variable' && item && item.variableCollectionId) {
    try {
      const collection = await figma.variables.getVariableCollectionByIdAsync(item.variableCollectionId);
      if (collection && collection.name) return collection.name;
    } catch (e) {
      console.warn('Could not resolve variable collection name:', e);
    }
  }
  if (item && typeof item.name === 'string' && item.name.includes('/')) {
    const first = item.name.split('/')[0].trim();
    if (first) return first;
  }
  return 'Remote Library';
}

// Collect every variable binding on a node, including paint-level bindings on
// fills/strokes. boundVariables[property] is sometimes a single VariableAlias
// (scalar fields like paddingLeft) and sometimes an array (componentProperties,
// or mirrors of paint arrays); the actual bind for fills/strokes lives in each
// paint's own boundVariables.color.
function collectBoundVariableRefs(node) {
  const refs = [];
  if ('boundVariables' in node && node.boundVariables) {
    for (const [property, value] of Object.entries(node.boundVariables)) {
      // Skip array-shaped entries — fills/strokes/effects/layoutGrids are
      // detected below by inspecting the paints themselves, and we don't
      // attempt to rebind componentProperties from this plugin.
      if (!value || Array.isArray(value)) continue;
      if (typeof value === 'object' && 'id' in value) {
        refs.push({ kind: 'scalar', property, variableId: value.id });
      }
    }
  }
  for (const list of ['fills', 'strokes']) {
    if (list in node) {
      const paints = node[list];
      if (Array.isArray(paints)) {
        for (let i = 0; i < paints.length; i++) {
          const paint = paints[i];
          const color = paint && paint.boundVariables && paint.boundVariables.color;
          if (color && color.id) {
            refs.push({ kind: 'paint', list, index: i, variableId: color.id });
          }
        }
      }
    }
  }
  return refs;
}

// Rebind a paint-level color variable. Paint arrays are read-only views; we
// have to clone the array, ask figma.variables.setBoundVariableForPaint to
// produce a new paint with the binding swapped, then reassign the array.
function rebindPaintVariable(node, list, index, localVar) {
  const paints = node[list];
  if (!Array.isArray(paints) || index < 0 || index >= paints.length) return false;
  const clones = paints.map(p => Object.assign({}, p));
  clones[index] = figma.variables.setBoundVariableForPaint(clones[index], 'color', localVar);
  node[list] = clones;
  return true;
}


// Get all pages in the document
function getAllPages() {
  return figma.root.children.filter(node => node.type === 'PAGE');
}


// Get all local styles by type (with caching)
async function getLocalStyles() {
  if (cachedLocalStyles) {
    return cachedLocalStyles;
  }

  cachedLocalStyles = {
    fillStyles: await figma.getLocalPaintStylesAsync(),
    textStyles: await figma.getLocalTextStylesAsync(),
    effectStyles: await figma.getLocalEffectStylesAsync()
  };

  return cachedLocalStyles;
}

// Get all local variables (with caching)
async function getLocalVariables() {
  if (cachedLocalVariables) {
    return cachedLocalVariables;
  }

  console.log('Getting local variable collections...');
  const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
  console.log(`Found ${localCollections.length} local collections`);

  const localVariables = [];

  for (const collection of localCollections) {
    console.log(`Processing collection: ${collection.name} with ${collection.variableIds.length} variables`);

    for (const variableId of collection.variableIds) {
      try {
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (variable) {
          // Store collection name with variable for better matching
          variable._collectionName = collection.name;
          localVariables.push(variable);
          console.log(`Added variable: ${variable.name} (remote: ${variable.remote || false})`);
        }
      } catch (error) {
        console.error('Error getting local variable:', error);
      }
    }
  }

  console.log(`Total local variables collected: ${localVariables.length}`);
  cachedLocalVariables = localVariables;
  return localVariables;
}

// Find local style by name and type (with fuzzy matching)
async function findLocalStyleByName(styleName, styleType, enableFuzzyMatch = true) {
  const localStyles = await getLocalStyles();

  let styleList;
  switch (styleType) {
    case 'fill style':
      styleList = localStyles.fillStyles;
      break;
    case 'text style':
      styleList = localStyles.textStyles;
      break;
    case 'effect style':
      styleList = localStyles.effectStyles;
      break;
    default:
      return null;
  }

  // 1. Try exact match first
  let match = styleList.find(style => style.name === styleName);
  if (match) {
    console.log(`Found exact style match: ${match.name}`);
    return match;
  }

  // 2. Try normalized match
  const normalizedTarget = normalizeVariableName(styleName);
  match = styleList.find(style =>
    normalizeVariableName(style.name) === normalizedTarget
  );
  if (match) {
    console.log(`Found normalized style match: ${match.name}`);
    return match;
  }

  // 3. Try segment match (last part of path)
  const targetSegment = getVariableSegment(styleName);
  match = styleList.find(style => {
    const styleSegment = getVariableSegment(style.name);
    return styleSegment === targetSegment ||
           normalizeVariableName(styleSegment) === normalizeVariableName(targetSegment);
  });
  if (match) {
    console.log(`Found segment style match: ${match.name}`);
    return match;
  }

  // 4. Fuzzy matching
  if (enableFuzzyMatch) {
    const SIMILARITY_THRESHOLD = 0.6;
    let bestMatch = null;
    let bestScore = 0;

    for (const style of styleList) {
      const score = calculateSimilarity(styleName, style.name);
      if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
        bestScore = score;
        bestMatch = style;
      }
    }

    if (bestMatch) {
      console.log(`Found fuzzy style match: ${bestMatch.name} (score: ${bestScore.toFixed(2)})`);
      return bestMatch;
    }
  }

  console.log(`No local style found matching: ${styleName} (type: ${styleType})`);
  return null;
}

// Normalize variable name for comparison (lowercase, remove extra spaces, normalize slashes)
function normalizeVariableName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .replace(/\s*\/\s*/g, '/')      // Normalize slashes
    .replace(/-/g, ' ')             // Treat hyphens as spaces
    .replace(/_/g, ' ');            // Treat underscores as spaces
}

// Get the final segment of a variable path (e.g., "xs" from "semantic/xs")
function getVariableSegment(name, position = 'last') {
  const segments = name.split('/').filter(s => s.trim());
  if (position === 'last') {
    return segments[segments.length - 1] || name;
  }
  return segments[0] || name;
}

// Calculate similarity score between two strings (0-1)
function calculateSimilarity(str1, str2) {
  const s1 = normalizeVariableName(str1);
  const s2 = normalizeVariableName(str2);

  // Exact match after normalization
  if (s1 === s2) return 1.0;

  // Check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  // Check final segment match
  const seg1 = getVariableSegment(s1);
  const seg2 = getVariableSegment(s2);
  if (seg1 === seg2) return 0.7;

  // Levenshtein-based similarity for close matches
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(s1, s2);
  const similarity = 1 - (distance / maxLen);

  return similarity;
}

// Simple Levenshtein distance implementation
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

// Find local variable by name with fuzzy matching support
async function findLocalVariableByName(variableName, enableFuzzyMatch = true) {
  console.log(`Searching for local variable with name: ${variableName}`);
  const localVariables = await getLocalVariables();
  console.log(`Found ${localVariables.length} local variables`);

  // 1. Try exact match first
  let matchingVariable = localVariables.find(variable => variable.name === variableName);

  if (matchingVariable) {
    console.log(`Found exact match: ${matchingVariable.name}`);
    return matchingVariable;
  }

  // 2. Try normalized exact match
  const normalizedTarget = normalizeVariableName(variableName);
  matchingVariable = localVariables.find(variable =>
    normalizeVariableName(variable.name) === normalizedTarget
  );

  if (matchingVariable) {
    console.log(`Found normalized match: ${matchingVariable.name}`);
    return matchingVariable;
  }

  // 3. Try matching final segment (e.g., "xs" from "semantic/xs")
  const targetSegment = getVariableSegment(variableName);
  matchingVariable = localVariables.find(variable => {
    const varSegment = getVariableSegment(variable.name);
    return varSegment === targetSegment ||
           normalizeVariableName(varSegment) === normalizeVariableName(targetSegment);
  });

  if (matchingVariable) {
    console.log(`Found segment match: ${matchingVariable.name} (matched on "${targetSegment}")`);
    return matchingVariable;
  }

  // 4. Fuzzy matching with similarity scoring
  if (enableFuzzyMatch) {
    const SIMILARITY_THRESHOLD = 0.6; // Minimum similarity to consider a match

    let bestMatch = null;
    let bestScore = 0;

    for (const variable of localVariables) {
      const score = calculateSimilarity(variableName, variable.name);
      if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
        bestScore = score;
        bestMatch = variable;
      }
    }

    if (bestMatch) {
      console.log(`Found fuzzy match: ${bestMatch.name} (score: ${bestScore.toFixed(2)})`);
      return bestMatch;
    }
  }

  // 5. No match found - log available options for debugging
  console.log(`No local variable found matching: ${variableName}`);
  console.log('Available local variable names:', localVariables.map(v => v.name).slice(0, 20));

  // Return suggestions for UI feedback
  const suggestions = localVariables
    .map(v => ({ name: v.name, score: calculateSimilarity(variableName, v.name) }))
    .filter(s => s.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (suggestions.length > 0) {
    console.log('Possible matches:', suggestions.map(s => `${s.name} (${(s.score * 100).toFixed(0)}%)`));
  }

  return null;
}

// Build (and cache) a flat list of every local COMPONENT / COMPONENT_SET in the
// document. We need all pages loaded because the local equivalent of a pasted
// remote component frequently lives on a different page than the instance.
async function getLocalComponents() {
  if (cachedLocalComponents) {
    return cachedLocalComponents;
  }

  await figma.loadAllPagesAsync();

  const components = [];
  function collect(node) {
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && !node.remote) {
      components.push(node);
    }
    if ('children' in node) {
      for (const child of node.children) {
        collect(child);
      }
    }
  }
  for (const page of figma.root.children) {
    collect(page);
  }

  console.log(`Collected ${components.length} local components/sets`);
  cachedLocalComponents = components;
  return components;
}

// Find a local component matching the given name. The remote node may be a
// COMPONENT inside a COMPONENT_SET; the local equivalent may be either a bare
// COMPONENT, a COMPONENT_SET (match by set name), or a COMPONENT inside a set
// (match by variant name). swapComponentAsync only accepts a ComponentNode, so
// when we match a COMPONENT_SET we return its defaultVariant.
async function findLocalComponentByName(componentName, enableFuzzyMatch = true) {
  const components = await getLocalComponents();

  const resolveSwapTarget = (node) => {
    if (node.type === 'COMPONENT_SET') {
      return node.defaultVariant || (node.children && node.children.find(c => c.type === 'COMPONENT')) || null;
    }
    return node;
  };

  // Some remote instance names arrive prefixed with the set name, e.g.
  // ".Component Page Header / State=Default". Try both forms.
  const candidates = [componentName];
  const slashIdx = componentName.indexOf('/');
  if (slashIdx > -1) {
    candidates.push(componentName.slice(0, slashIdx).trim());
    candidates.push(componentName.slice(slashIdx + 1).trim());
  }

  // 1. Exact match (across all candidate names)
  for (const name of candidates) {
    const match = components.find(c => c.name === name);
    if (match) {
      console.log(`Found exact component match: ${match.name} (${match.type})`);
      const target = resolveSwapTarget(match);
      if (target) return target;
    }
  }

  // 2. Normalized match
  for (const name of candidates) {
    const normalizedTarget = normalizeVariableName(name);
    const match = components.find(c => normalizeVariableName(c.name) === normalizedTarget);
    if (match) {
      console.log(`Found normalized component match: ${match.name}`);
      const target = resolveSwapTarget(match);
      if (target) return target;
    }
  }

  // 3. Final-segment match (handles "Foo/Bar" vs "Bar")
  for (const name of candidates) {
    const targetSegment = getVariableSegment(name);
    const match = components.find(c => {
      const seg = getVariableSegment(c.name);
      return seg === targetSegment ||
             normalizeVariableName(seg) === normalizeVariableName(targetSegment);
    });
    if (match) {
      console.log(`Found segment component match: ${match.name}`);
      const target = resolveSwapTarget(match);
      if (target) return target;
    }
  }

  // 4. Fuzzy match
  if (enableFuzzyMatch) {
    const SIMILARITY_THRESHOLD = 0.6;
    let bestMatch = null;
    let bestScore = 0;
    for (const component of components) {
      for (const name of candidates) {
        const score = calculateSimilarity(name, component.name);
        if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
          bestScore = score;
          bestMatch = component;
        }
      }
    }
    if (bestMatch) {
      console.log(`Found fuzzy component match: ${bestMatch.name} (score: ${bestScore.toFixed(2)})`);
      const target = resolveSwapTarget(bestMatch);
      if (target) return target;
    }
  }

  console.log(`No local component found matching: ${componentName}`);
  console.log('Available local component names:', components.map(c => c.name).slice(0, 20));
  return null;
}

// Auto-fix remote styles by replacing with local ones
async function autoFixRemoteStyles(scanType = 'current') {
  let fixCount = 0;
  
  try {
    figma.ui.postMessage({
      type: 'fix-started',
      scanType: scanType
    });
    
    if (scanType === 'selection') {
      // Fix only selected nodes
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.ui.postMessage({
          type: 'scan-error',
          message: 'No selection found'
        });
        return 0;
      }
      
      for (const node of selection) {
        fixCount += await autoFixNodeStyles(node);
      }
    } else if (scanType === 'all') {
      // Load all pages first
      await figma.loadAllPagesAsync();
      const pagesToScan = getAllPages();
      
      for (const page of pagesToScan) {
        fixCount += await autoFixPageStyles(page);
      }
    } else {
      // Fix current page
      fixCount += await autoFixPageStyles(figma.currentPage);
    }
  
    figma.ui.postMessage({
      type: 'fix-complete',
      fixCount: fixCount,
      scanType: scanType
    });
    
    return fixCount;
    
  } catch (error) {
    console.error('Error during auto-fix:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error occurred during auto-fix: ' + error.message
    });
  }
}

// Auto-fix styles in a specific node and its children
async function autoFixNodeStyles(rootNode) {
  let fixCount = 0;
  
  async function fixNodeStyles(node) {
    // Skip the page node itself
    if (node.type === 'PAGE') {
      if ('children' in node) {
        for (const child of node.children) {
          fixCount += await fixNodeStyles(child);
        }
      }
      return fixCount;
    }

    // Swap remote component instances → local
    if (node.type === 'INSTANCE') {
      try {
        const mainComponent = await node.getMainComponentAsync();
        if (mainComponent && mainComponent.remote) {
          const localComponent = await findLocalComponentByName(mainComponent.name);
          if (localComponent) {
            try {
              await node.swapComponentAsync(localComponent);
              fixCount++;
            } catch (swapErr) {
              console.error(`Swap failed for "${mainComponent.name}":`, swapErr);
            }
          }
        }
      } catch (error) {
        console.error('Error swapping component:', error);
      }
    }

    // Check and fix fill styles
    if ('fillStyleId' in node && node.fillStyleId) {
      const styleId = node.fillStyleId;
      if (typeof styleId === 'string') {
        try {
          const style = await figma.getStyleByIdAsync(styleId);
          if (style && style.remote) {
            const localStyle = await findLocalStyleByName(style.name, 'fill style');
            if (localStyle) {
              await node.setFillStyleIdAsync(localStyle.id);
              fixCount++;
            }
          }
        } catch (error) {
          console.error('Error getting fill style:', error);
        }
      }
    }
    
    // Check and fix text styles
    if ('textStyleId' in node && node.textStyleId) {
      const styleId = node.textStyleId;
      if (typeof styleId === 'string') {
        try {
          const style = await figma.getStyleByIdAsync(styleId);
          if (style && style.remote) {
            const localStyle = await findLocalStyleByName(style.name, 'text style');
            if (localStyle) {
              await node.setTextStyleIdAsync(localStyle.id);
              fixCount++;
            }
          }
        } catch (error) {
          console.error('Error getting text style:', error);
        }
      }
    }
    
    // Check and fix effect styles
    if ('effectStyleId' in node && node.effectStyleId) {
      const styleId = node.effectStyleId;
      if (typeof styleId === 'string') {
        try {
          const style = await figma.getStyleByIdAsync(styleId);
          if (style && style.remote) {
            const localStyle = await findLocalStyleByName(style.name, 'effect style');
            if (localStyle) {
              await node.setEffectStyleIdAsync(localStyle.id);
              fixCount++;
            }
          }
        } catch (error) {
          console.error('Error getting effect style:', error);
        }
      }
    }
    
    // Check and fix bound variables (scalar + paint-level)
    const refs = collectBoundVariableRefs(node);
    for (const ref of refs) {
      try {
        const variable = await figma.variables.getVariableByIdAsync(ref.variableId);
        if (!variable || !variable.remote) continue;
        const localVariable = await findLocalVariableByName(variable.name);
        if (!localVariable) continue;
        if (ref.kind === 'scalar') {
          await node.setBoundVariableAsync(ref.property, localVariable);
          fixCount++;
        } else if (ref.kind === 'paint') {
          if (rebindPaintVariable(node, ref.list, ref.index, localVariable)) {
            fixCount++;
          }
        }
      } catch (error) {
        console.error('Error fixing variable:', error);
      }
    }

    // Recursively fix children
    if ('children' in node) {
      for (const child of node.children) {
        fixCount += await fixNodeStyles(child);
      }
    }

    return 0; // Individual node doesn't return count, only accumulated in fixCount
  }
  
  await fixNodeStyles(rootNode);
  return fixCount;
}

// Auto-fix styles in a specific page
async function autoFixPageStyles(page) {
  return await autoFixNodeStyles(page);
}

// Scan current page for all libraries used
async function scanCurrentPage() {
  librariesFound = [];
  foundElements = [];
  scanCancelled = false;
  currentScanId = Date.now().toString();
  currentScanType = 'current';
  const currentPage = figma.currentPage;
  
  if (!currentPage) {
    figma.ui.postMessage({
      type: 'scan-complete',
      libraries: [],
      message: 'No page selected'
    });
    return;
  }
  
  try {
    // Send page info to UI
    figma.ui.postMessage({
      type: 'scan-started',
      pageName: currentPage.name,
      scanType: 'current',
      scanId: currentScanId
    });
    
    // Scan all nodes in the current page with batching
    await scanNodeWithBatching(currentPage);
    
    if (!scanCancelled) {
      // Remove duplicates and sort
      const uniqueLibraries = removeDuplicateLibraries(librariesFound);
      
      // Determine message based on what was found
      const hasRemoteLibraries = uniqueLibraries.some(lib => lib.type === 'remote');
      const hasLocalLibraries = uniqueLibraries.some(lib => lib.type === 'local');
      
      let message, messageType;
      if (uniqueLibraries.length === 0) {
        message = 'No libraries found on this page';
        messageType = 'info';
      } else if (hasRemoteLibraries) {
        message = 'Please convert the remote styles to local styles';
        messageType = 'error';
      } else if (hasLocalLibraries) {
        message = 'Everything clean, everything local';
        messageType = 'success';
      } else {
        message = `Found ${uniqueLibraries.length} libraries used on this page`;
        messageType = 'info';
      }
      
      figma.ui.postMessage({
        type: 'scan-complete',
        libraries: uniqueLibraries,
        pageName: currentPage.name,
        message: message,
        messageType: messageType,
        scanType: 'current'
      });
    }
    
  } catch (error) {
    console.error('Error during scan:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error occurred during scan: ' + error.message
    });
  }
}

// Scan all pages in the document
async function scanAllPages() {
  librariesFound = [];
  foundElements = [];
  scanCancelled = false;
  currentScanId = Date.now().toString();
  currentScanType = 'all';
  
  try {
    // Load all pages first
    await figma.loadAllPagesAsync();
    const allPages = getAllPages();
    
    if (allPages.length === 0) {
      figma.ui.postMessage({
        type: 'scan-complete',
        libraries: [],
        message: 'No pages found in document'
      });
      return;
    }
    
    // Send scan started info to UI
    figma.ui.postMessage({
      type: 'scan-started',
      pageName: `All Pages (${allPages.length} pages)`,
      scanType: 'all',
      scanId: currentScanId
    });
    
    // Scan all pages with batch processing
    for (let i = 0; i < allPages.length; i++) {
      if (scanCancelled) {
        figma.ui.postMessage({
          type: 'scan-cancelled',
          message: 'Scan was cancelled'
        });
        return;
      }
      
      const page = allPages[i];
      
      // Send progress update
      figma.ui.postMessage({
        type: 'scan-progress',
        currentPage: page.name,
        progress: i + 1,
        total: allPages.length
      });
      
      await scanNodeWithBatching(page);
      
      // No element limit - scan everything
    }
    
    if (!scanCancelled) {
      // Remove duplicates and sort
      const uniqueLibraries = removeDuplicateLibraries(librariesFound);
      
      // Determine message based on what was found
      const hasRemoteLibraries = uniqueLibraries.some(lib => lib.type === 'remote');
      const hasLocalLibraries = uniqueLibraries.some(lib => lib.type === 'local');
      
      let message, messageType;
      if (uniqueLibraries.length === 0) {
        message = 'No libraries found in any page';
        messageType = 'info';
      } else if (hasRemoteLibraries) {
        message = 'Please convert the remote styles to local styles';
        messageType = 'error';
      } else if (hasLocalLibraries) {
        message = 'Everything clean, everything local';
        messageType = 'success';
      } else {
        message = `Found ${uniqueLibraries.length} libraries used across all pages`;
        messageType = 'info';
      }
      
      figma.ui.postMessage({
        type: 'scan-complete',
        libraries: uniqueLibraries,
        pageName: `All Pages (${allPages.length} pages)`,
        message: message,
        messageType: messageType,
        scanType: 'all'
      });
    }
    
  } catch (error) {
    console.error('Error during scan:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error occurred during scan: ' + error.message
    });
  }
}

// Batch processing wrapper for large node scans
async function scanNodeWithBatching(rootNode) {
  const nodesToScan = [];
  
  // Collect all nodes first
  function collectNodes(node) {
    nodesToScan.push(node);
    if ('children' in node) {
      for (const child of node.children) {
        collectNodes(child);
      }
    }
  }
  
  collectNodes(rootNode);
  
  // Process nodes in batches
  for (let i = 0; i < nodesToScan.length; i += BATCH_SIZE) {
    if (scanCancelled) {
      break;
    }
    
    const batch = nodesToScan.slice(i, i + BATCH_SIZE);
    
    // Process batch
    for (const node of batch) {
      if (scanCancelled) {
        break;
      }
      await scanSingleNode(node);
    }
    
    // Send progress update for large scans
    if (nodesToScan.length > 200 && i % (BATCH_SIZE * 2) === 0) {
      figma.ui.postMessage({
        type: 'scan-node-progress',
        processed: Math.min(i + BATCH_SIZE, nodesToScan.length),
        total: nodesToScan.length
      });
    }
    
    // Small delay to prevent UI blocking
    if (BATCH_DELAY > 0) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }
}

// Timeout wrapper for async operations
async function withTimeout(asyncFn, timeoutMs = 5000) {
  return Promise.race([
    asyncFn(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
    )
  ]);
}

async function recordStyleUsage(node, styleType) {
  const propMap = {
    'fill style': 'fillStyleId',
    'text style': 'textStyleId',
    'effect style': 'effectStyleId'
  };
  const prop = propMap[styleType];
  if (!(prop in node) || !node[prop] || typeof node[prop] !== 'string') return;

  try {
    const style = await withTimeout(() => figma.getStyleByIdAsync(node[prop]), 2000);
    if (!style) return;
    const elementId = generateElementId();
    foundElements.push({ id: elementId, nodeId: node.id, nodeName: node.name });

    if (style.remote) {
      addLibrary({
        name: await remoteLibraryLabel('style', style),
        id: 'remote',
        type: 'remote',
        elementType: styleType,
        elementName: style.name,
        elementId: elementId,
        nodeName: node.name
      });
    } else {
      addLibrary({
        name: 'Local Styles',
        id: 'local',
        type: 'local',
        elementType: styleType,
        elementName: style.name,
        elementId: elementId,
        nodeName: node.name
      });
    }
  } catch (error) {
    console.error(`Error getting ${styleType}:`, error);
  }
}

// Scan a single node for library usage
async function scanSingleNode(node) {
  if (node.type === 'PAGE') return;

  // Component instances
  if (node.type === 'INSTANCE') {
    try {
      const mainComponent = await withTimeout(() => node.getMainComponentAsync(), 3000);
      if (mainComponent) {
        const elementId = generateElementId();
        foundElements.push({ id: elementId, nodeId: node.id, nodeName: node.name });

        if (mainComponent.remote) {
          addLibrary({
            name: await remoteLibraryLabel('component', mainComponent),
            id: 'remote',
            type: 'remote',
            elementType: 'component',
            elementName: mainComponent.name,
            elementId: elementId,
            nodeName: node.name
          });
        } else {
          addLibrary({
            name: 'Local Components',
            id: 'local',
            type: 'local',
            elementType: 'component',
            elementName: mainComponent.name,
            elementId: elementId,
            nodeName: node.name
          });
        }
      }
    } catch (error) {
      console.error('Error getting main component:', error);
    }
  }

  await recordStyleUsage(node, 'fill style');
  await recordStyleUsage(node, 'text style');
  await recordStyleUsage(node, 'effect style');

  // Bound variables (scalar + paint-level)
  const refs = collectBoundVariableRefs(node);
  for (const ref of refs) {
    try {
      const variable = await withTimeout(() => figma.variables.getVariableByIdAsync(ref.variableId), 2000);
      if (!variable) continue;
      const elementId = generateElementId();
      foundElements.push({ id: elementId, nodeId: node.id, nodeName: node.name });

      const propertyLabel = ref.kind === 'paint'
        ? `${ref.list}[${ref.index}]`
        : ref.property;

      if (variable.remote) {
        addLibrary({
          name: await remoteLibraryLabel('variable', variable),
          id: 'remote',
          type: 'remote',
          elementType: 'variable',
          elementName: `${variable.name} (${propertyLabel})`,
          elementId: elementId,
          nodeName: node.name
        });
      } else {
        addLibrary({
          name: 'Local Variables',
          id: 'local',
          type: 'local',
          elementType: 'variable',
          elementName: `${variable.name} (${propertyLabel})`,
          elementId: elementId,
          nodeName: node.name
        });
      }
    } catch (error) {
      console.error('Error getting variable:', error);
    }
  }
}

function generateElementId() {
  return 'element_' + Math.random().toString(36).slice(2, 11);
}

function addLibrary(libraryInfo) {
  // Always add each element instance
  librariesFound.push(libraryInfo);
}


// Handle fixing individual element
async function handleFixIndividualElement(elementId, libraryName) {
  const element = foundElements.find(el => el.id === elementId);
  
  if (!element) {
    figma.ui.postMessage({
      type: 'individual-fix-complete',
      elementId: elementId,
      success: false,
      error: 'Element not found'
    });
    return;
  }
  
  try {
    const node = await figma.getNodeByIdAsync(element.nodeId);
    if (!node) {
      figma.ui.postMessage({
        type: 'individual-fix-complete',
        elementId: elementId,
        success: false,
        error: 'Node not found'
      });
      return;
    }
    
    let fixCount = 0;
    let elementName = '';
    
    // Check and fix component instances
    let componentLookupDetail = null;
    if (node.type === 'INSTANCE' && 'getMainComponentAsync' in node) {
      try {
        const mainBefore = await withTimeout(() => node.getMainComponentAsync(), 3000);
        if (mainBefore && mainBefore.remote) {
          const localComponent = await findLocalComponentByName(mainBefore.name);
          if (localComponent) {
            if (localComponent.id === mainBefore.id) {
              componentLookupDetail = `Index returned the same node as the current main (${mainBefore.name}). Local copy missing — try Refresh Local Index, or check the component actually exists locally.`;
            } else {
              try {
                console.log(`Swap target: name="${localComponent.name}" id=${localComponent.id} type=${localComponent.type} remote=${localComponent.remote}`);
                await node.swapComponentAsync(localComponent);
                // Verify: the instance's main should now point to localComponent and be non-remote.
                const mainAfter = await node.getMainComponentAsync();
                if (mainAfter && mainAfter.id === localComponent.id && !mainAfter.remote) {
                  fixCount++;
                  elementName = `${mainBefore.name} → local ${mainAfter.name}`;
                } else if (mainAfter && mainAfter.remote) {
                  componentLookupDetail = `swapComponentAsync succeeded but main is still remote (${mainAfter.name}). The local match may itself be a published library node, or this instance is locked by its parent. Try detaching/recreating, or fix the master directly.`;
                } else {
                  componentLookupDetail = `swapComponentAsync returned but main did not change. Tried: ${localComponent.name}`;
                }
              } catch (swapErr) {
                componentLookupDetail = `Swap failed: ${swapErr.message}`;
              }
            }
          } else {
            const all = await getLocalComponents();
            const sample = all.slice(0, 5).map(c => c.name).join(', ');
            componentLookupDetail = `No local match for "${mainBefore.name}" — ${all.length} local components indexed${all.length ? ` (e.g. ${sample})` : '. Try "Refresh Local Index"'}`;
          }
        }
      } catch (error) {
        console.error('Error fixing component:', error);
        componentLookupDetail = `Error: ${error.message}`;
      }
    }
    
    // Check and fix fill styles
    if ('fillStyleId' in node && node.fillStyleId && typeof node.fillStyleId === 'string') {
      try {
        const style = await withTimeout(() => figma.getStyleByIdAsync(node.fillStyleId), 2000);
        if (style && style.remote) {
          const localStyle = await findLocalStyleByName(style.name, 'fill style');
          if (localStyle) {
            await node.setFillStyleIdAsync(localStyle.id);
            fixCount++;
            elementName = style.name;
          }
        }
      } catch (error) {
        console.error('Error fixing fill style:', error);
      }
    }
    
    // Check and fix text styles
    if ('textStyleId' in node && node.textStyleId && typeof node.textStyleId === 'string') {
      try {
        const style = await withTimeout(() => figma.getStyleByIdAsync(node.textStyleId), 2000);
        if (style && style.remote) {
          const localStyle = await findLocalStyleByName(style.name, 'text style');
          if (localStyle) {
            await node.setTextStyleIdAsync(localStyle.id);
            fixCount++;
            elementName = style.name;
          }
        }
      } catch (error) {
        console.error('Error fixing text style:', error);
      }
    }
    
    // Check and fix effect styles
    if ('effectStyleId' in node && node.effectStyleId && typeof node.effectStyleId === 'string') {
      try {
        const style = await withTimeout(() => figma.getStyleByIdAsync(node.effectStyleId), 2000);
        if (style && style.remote) {
          const localStyle = await findLocalStyleByName(style.name, 'effect style');
          if (localStyle) {
            await node.setEffectStyleIdAsync(localStyle.id);
            fixCount++;
            elementName = style.name;
          }
        }
      } catch (error) {
        console.error('Error fixing effect style:', error);
      }
    }
    
    // Check and fix bound variables (scalar + paint-level)
    const refs = collectBoundVariableRefs(node);
    for (const ref of refs) {
      try {
        const variable = await withTimeout(() => figma.variables.getVariableByIdAsync(ref.variableId), 2000);
        if (!variable || !variable.remote) continue;
        const localVariable = await findLocalVariableByName(variable.name);
        if (!localVariable) continue;
        const propertyLabel = ref.kind === 'paint'
          ? `${ref.list}[${ref.index}]`
          : ref.property;
        if (ref.kind === 'scalar') {
          await node.setBoundVariableAsync(ref.property, localVariable);
          fixCount++;
          elementName = `${variable.name} (${propertyLabel})`;
        } else if (ref.kind === 'paint') {
          if (rebindPaintVariable(node, ref.list, ref.index, localVariable)) {
            fixCount++;
            elementName = `${variable.name} (${propertyLabel})`;
          }
        }
      } catch (error) {
        console.error('Error fixing variable:', error);
      }
    }
    
    figma.ui.postMessage({
      type: 'individual-fix-complete',
      elementId: elementId,
      success: fixCount > 0,
      elementName: elementName || element.nodeName,
      error: fixCount === 0 ? (componentLookupDetail || 'No matching local style/component found') : null
    });
    
  } catch (error) {
    console.error('Error fixing individual element:', error);
    figma.ui.postMessage({
      type: 'individual-fix-complete',
      elementId: elementId,
      success: false,
      error: error.message
    });
  }
}

// Handle inspect element functionality
async function handleInspectElement(elementId) {
  const element = foundElements.find(el => el.id === elementId);
  
  if (!element) {
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Element not found. Try scanning again.'
    });
    return;
  }
  
  if (!element.nodeId) {
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Element has no node ID. Try scanning again.'
    });
    return;
  }
  
  try {
    const node = await figma.getNodeByIdAsync(element.nodeId);
    if (!node) {
      figma.ui.postMessage({
        type: 'scan-error',
        message: 'Node not found. It may have been deleted or moved to another page.'
      });
      return;
    }
    
    // Find the page that contains this node
    let currentNode = node;
    let containingPage = null;
    
    while (currentNode && currentNode.type !== 'PAGE') {
      currentNode = currentNode.parent;
    }
    
    if (currentNode && currentNode.type === 'PAGE') {
      containingPage = currentNode;
      
      // Switch to the correct page if needed
      if (containingPage !== figma.currentPage) {
        await figma.setCurrentPageAsync(containingPage);
      }
    }
    
    // Now select and zoom to the node
    // Note: selection doesn't have an async setter, but we need to ensure we're on the right page first
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    
    figma.ui.postMessage({
      type: 'element-selected',
      elementId: elementId,
      nodeName: element.nodeName
    });
    
  } catch (error) {
    console.error('Error inspecting element:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error accessing node: ' + error.message
    });
  }
}

function removeDuplicateLibraries(libraries) {
  const uniqueLibraries = {};
  
  libraries.forEach(lib => {
    if (!uniqueLibraries[lib.name]) {
      uniqueLibraries[lib.name] = {
        name: lib.name,
        id: lib.id,
        type: lib.type,
        elements: []
      };
    }
    
    // Add each element instance (don't deduplicate by name)
    uniqueLibraries[lib.name].elements.push({
      type: lib.elementType,
      name: lib.elementName,
      elementId: lib.elementId,
      nodeName: lib.nodeName
    });
  });
  
  // Convert to array and sort
  return Object.values(uniqueLibraries).sort((a, b) => {
    // Sort local first, then by name
    if (a.type === 'local' && b.type !== 'local') return -1;
    if (a.type !== 'local' && b.type === 'local') return 1;
    return a.name.localeCompare(b.name);
  });
}

// Scan current selection for all libraries used
async function scanCurrentSelection() {
  librariesFound = [];
  foundElements = [];
  scanCancelled = false;
  currentScanId = Date.now().toString();
  currentScanType = 'selection';
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'scan-complete',
      libraries: [],
      message: 'No selection found',
      scanType: 'selection'
    });
    return;
  }
  
  try {
    // Send scan started info to UI
    figma.ui.postMessage({
      type: 'scan-started',
      pageName: `Selection (${selection.length} item${selection.length !== 1 ? 's' : ''})`,
      scanType: 'selection',
      scanId: currentScanId
    });
    
    // Scan all selected nodes with batching
    for (const node of selection) {
      if (scanCancelled) {
        figma.ui.postMessage({
          type: 'scan-cancelled',
          message: 'Scan was cancelled'
        });
        return;
      }
      await scanNodeWithBatching(node);
    }
    
    if (!scanCancelled) {
      // Remove duplicates and sort
      const uniqueLibraries = removeDuplicateLibraries(librariesFound);
      
      // Determine message based on what was found
      const hasRemoteLibraries = uniqueLibraries.some(lib => lib.type === 'remote');
      const hasLocalLibraries = uniqueLibraries.some(lib => lib.type === 'local');
      
      let message, messageType;
      if (uniqueLibraries.length === 0) {
        message = 'No libraries found in selection';
        messageType = 'info';
      } else if (hasRemoteLibraries) {
        message = 'Please convert the remote styles to local styles';
        messageType = 'error';
      } else if (hasLocalLibraries) {
        message = 'Everything clean, everything local';
        messageType = 'success';
      } else {
        message = `Found ${uniqueLibraries.length} libraries used in selection`;
        messageType = 'info';
      }
      
      figma.ui.postMessage({
        type: 'scan-complete',
        libraries: uniqueLibraries,
        pageName: `Selection (${selection.length} item${selection.length !== 1 ? 's' : ''})`,
        message: message,
        messageType: messageType,
        scanType: 'selection'
      });
    }
    
  } catch (error) {
    console.error('Error during scan:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error occurred during scan: ' + error.message
    });
  }
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'refresh-local-cache':
      try {
        figma.ui.postMessage({ type: 'cache-refresh-started' });
        const counts = await refreshLocalCache();
        figma.ui.postMessage({ type: 'cache-status', counts: counts, fresh: true });
      } catch (error) {
        figma.ui.postMessage({ type: 'cache-status', counts: null, error: error.message });
      }
      break;

    case 'cache-status':
      figma.ui.postMessage({ type: 'cache-status', counts: await localCacheCounts(), fresh: false });
      break;

    case 'scan-current':
      await scanCurrentPage();
      break;

    case 'scan-all':
      await scanAllPages();
      break;

    case 'scan-selection':
      await scanCurrentSelection();
      break;
      
      
    case 'fix-current':
      await autoFixRemoteStyles('current');
      break;
      
    case 'fix-all':
      await autoFixRemoteStyles('all');
      break;
      
    case 'fix-selection':
      await autoFixRemoteStyles('selection');
      break;
      
    case 'cancel-scan':
      scanCancelled = true;
      break;
      
    case 'scan':
      // Backward compatibility
      await scanCurrentPage();
      break;
      
    case 'inspect-element':
      await handleInspectElement(msg.elementId);
      break;
      
    case 'fix-individual-element':
      await handleFixIndividualElement(msg.elementId, msg.libraryName);
      break;
      
    case 'close':
      figma.closePlugin();
      break;
  }
};