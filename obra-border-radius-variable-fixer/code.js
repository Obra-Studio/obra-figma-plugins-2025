// code.js
var layersWithIssues = [];
var borderRadiusVariables = [];
var allBorderRadiusVariables = []; // All variables before filtering
var variableCollections = []; // All collections with border radius variables
var selectedCollectionIds = []; // Currently selected collections (empty = all)
var currentIndex = -1;
var isScanning = false;

// Initialize the plugin
figma.showUI(__html__, { width: 450, height: 600 });

// Load selected collections and scan for variables on startup
loadSelectedCollections().then(function() {
  scanForBorderRadiusVariables();
});

// Resolve variable value, following aliases if needed
async function resolveVariableValue(variable, modeId) {
  var value = variable.valuesByMode[modeId];

  // If value is an alias (reference to another variable), resolve it
  var maxDepth = 10; // Prevent infinite loops
  var depth = 0;

  while (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS' && depth < maxDepth) {
    try {
      var referencedVar = await figma.variables.getVariableByIdAsync(value.id);
      if (referencedVar && referencedVar.valuesByMode) {
        // Try to use the same mode, or fall back to first mode
        var refCollection = await figma.variables.getVariableCollectionByIdAsync(referencedVar.variableCollectionId);
        var refModeId = refCollection && refCollection.modes && refCollection.modes.length > 0
          ? refCollection.modes[0].modeId
          : Object.keys(referencedVar.valuesByMode)[0];
        value = referencedVar.valuesByMode[refModeId];
      } else {
        break;
      }
    } catch (e) {
      console.log('Error resolving alias:', e.message);
      break;
    }
    depth++;
  }

  return typeof value === 'number' ? value : null;
}

// Process a single variable and add to results if it's a border radius variable
async function processVariable(variable, collectionsMap, isLibrary, libraryName) {
  // Check for corner radius scope
  if (!variable.scopes || variable.scopes.indexOf('CORNER_RADIUS') === -1) {
    return null;
  }

  console.log('Found border radius variable:', variable.name, isLibrary ? '(from library: ' + libraryName + ')' : '(local)');

  // Get the variable's numeric value and collection info
  var numericValue = null;
  var collectionId = variable.variableCollectionId;
  var collectionName = 'Unknown';

  try {
    var collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (collection) {
      collectionName = collection.name;
      if (isLibrary && libraryName) {
        collectionName = libraryName + ' / ' + collectionName;
      }

      // Track this collection
      if (!collectionsMap[collectionId]) {
        collectionsMap[collectionId] = {
          id: collectionId,
          name: collectionName,
          variableCount: 0,
          isLibrary: isLibrary
        };
      }
      collectionsMap[collectionId].variableCount++;

      if (collection.modes && collection.modes.length > 0) {
        var defaultMode = collection.modes[0];
        numericValue = await resolveVariableValue(variable, defaultMode.modeId);
      }
    }
  } catch (e) {
    console.log('Error getting value for variable', variable.name, ':', e.message);
  }

  if (numericValue !== null) {
    return {
      id: variable.id,
      name: variable.name,
      value: numericValue,
      variable: variable,
      collectionId: collectionId,
      collectionName: collectionName,
      isLibrary: isLibrary
    };
  }

  return null;
}

// Scan for all border radius variables and their values
async function scanForBorderRadiusVariables() {
  console.log('Starting variable scan...');
  allBorderRadiusVariables = [];
  variableCollections = [];
  var collectionsMap = {};

  try {
    // 1. Scan local variables
    var localVariables = await figma.variables.getLocalVariablesAsync();
    console.log('Found', localVariables.length, 'total local variables');

    for (var i = 0; i < localVariables.length; i++) {
      var result = await processVariable(localVariables[i], collectionsMap, false, null);
      if (result) {
        allBorderRadiusVariables.push(result);
      }
    }

    // 2. Scan library variables
    try {
      var libraryCollections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
      console.log('Found', libraryCollections.length, 'library variable collections');

      for (var j = 0; j < libraryCollections.length; j++) {
        var libCollection = libraryCollections[j];
        console.log('Scanning library collection:', libCollection.name, 'from', libCollection.libraryName);

        try {
          var libraryVariables = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libCollection.key);
          console.log('Found', libraryVariables.length, 'variables in library collection', libCollection.name);

          for (var k = 0; k < libraryVariables.length; k++) {
            var libVar = libraryVariables[k];

            // Import the variable to get full access to it
            try {
              var importedVariable = await figma.variables.importVariableByKeyAsync(libVar.key);
              var result = await processVariable(importedVariable, collectionsMap, true, libCollection.libraryName);
              if (result) {
                allBorderRadiusVariables.push(result);
              }
            } catch (importError) {
              console.log('Error importing library variable', libVar.name, ':', importError.message);
            }
          }
        } catch (collectionError) {
          console.log('Error getting variables from library collection', libCollection.name, ':', collectionError.message);
        }
      }
    } catch (libraryError) {
      console.log('Error scanning library variables:', libraryError.message);
      // Continue without library variables
    }

    // Convert collections map to array
    variableCollections = Object.keys(collectionsMap).map(function(key) {
      return collectionsMap[key];
    });

    // Sort collections by name (local first, then libraries)
    variableCollections.sort(function(a, b) {
      if (a.isLibrary !== b.isLibrary) {
        return a.isLibrary ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });

    // Sort all variables by their numeric value
    allBorderRadiusVariables.sort(function(a, b) {
      return a.value - b.value;
    });

    console.log('Found', allBorderRadiusVariables.length, 'border radius variables with values');
    console.log('Found', variableCollections.length, 'collections with border radius variables');

    // Apply collection filter
    applyCollectionFilter();

    // Send collections to UI
    figma.ui.postMessage({
      type: 'collections-found',
      collections: variableCollections,
      selectedCollectionIds: selectedCollectionIds
    });

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

// Apply collection filter to border radius variables
function applyCollectionFilter() {
  if (selectedCollectionIds.length === 0) {
    // No filter - use all variables
    borderRadiusVariables = allBorderRadiusVariables.slice();
  } else {
    // Filter by selected collections
    borderRadiusVariables = allBorderRadiusVariables.filter(function(v) {
      return selectedCollectionIds.indexOf(v.collectionId) !== -1;
    });
  }

  console.log('Filtered to', borderRadiusVariables.length, 'variables from', selectedCollectionIds.length, 'collections');

  // Send filtered variables to UI
  figma.ui.postMessage({
    type: 'variables-found',
    variables: borderRadiusVariables.map(function(v) {
      return {
        id: v.id,
        name: v.name,
        value: v.value,
        collectionId: v.collectionId,
        collectionName: v.collectionName
      };
    })
  });
}

// Find matching variable for a given radius value
function findMatchingVariable(radiusValue) {
  for (var i = 0; i < borderRadiusVariables.length; i++) {
    if (borderRadiusVariables[i].value === radiusValue) {
      return borderRadiusVariables[i];
    }
  }
  return null;
}

// Check if node has any border radius bound variables
function hasRadiusVariable(node) {
  try {
    if (!node.boundVariables) return false;
    
    var radiusProperties = ['cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];
    
    for (var i = 0; i < radiusProperties.length; i++) {
      var prop = radiusProperties[i];
      try {
        if (node.boundVariables[prop]) {
          console.log('Found bound variable for', prop, 'on node', node.name);
          return true;
        }
      } catch (e) {
        console.log('Error checking bound variable for', prop + ':', e.message);
      }
    }
    
    return false;
  } catch (e) {
    console.log('Error checking for radius variables on node', node.name + ':', e.message);
    return false;
  }
}

// Get detailed radius information from a node
function getDetailedRadiusInfo(node) {
  console.log('Getting detailed radius info for node:', node.name);
  
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
  
  var radiusInfo = {
    cornerRadius: getNumericValue(node.cornerRadius),
    topLeftRadius: getNumericValue(node.topLeftRadius),
    topRightRadius: getNumericValue(node.topRightRadius),
    bottomLeftRadius: getNumericValue(node.bottomLeftRadius),
    bottomRightRadius: getNumericValue(node.bottomRightRadius),
    hasIndividualCorners: false,
    hasVariables: false
  };
  
  // Check if using individual corners instead of global corner radius
  var individualCorners = [radiusInfo.topLeftRadius, radiusInfo.topRightRadius, radiusInfo.bottomLeftRadius, radiusInfo.bottomRightRadius];
  var hasNonZeroIndividual = false;
  var hasVariableIndividual = false;
  
  for (var i = 0; i < individualCorners.length; i++) {
    if (individualCorners[i] === 'variable') {
      hasVariableIndividual = true;
      radiusInfo.hasVariables = true;
    } else if (individualCorners[i] !== null && individualCorners[i] > 0) {
      hasNonZeroIndividual = true;
    }
  }
  
  // Check if corner radius has variable
  if (radiusInfo.cornerRadius === 'variable') {
    radiusInfo.hasVariables = true;
  }
  
  radiusInfo.hasIndividualCorners = hasNonZeroIndividual || hasVariableIndividual;
  
  console.log('Detailed radius info:', radiusInfo);
  return radiusInfo;
}

// Recursively find layers with radius issues
function findLayersWithRadiusIssues(node, results, ignoredNames) {
  results = results || [];
  ignoredNames = ignoredNames || [];

  try {
    console.log('Checking node:', node.name, 'type:', node.type);

    // Always ignore COMPONENT_SET layers (component variants) and ELLIPSE (already round)
    if (node.type === 'COMPONENT_SET' || node.type === 'ELLIPSE') {
      console.log('Ignoring', node.type + ':', node.name);
      // Still check children but don't include this node
      if ('children' in node) {
        try {
          for (var j = 0; j < node.children.length; j++) {
            findLayersWithRadiusIssues(node.children[j], results, ignoredNames);
          }
        } catch (e) {
          console.log('Error processing children of', node.type, node.name + ':', e.message);
        }
      }
      return results;
    }

    // Check if this layer should be ignored (exact match)
    for (var k = 0; k < ignoredNames.length; k++) {
      if (node.name === ignoredNames[k]) {
        console.log('Ignoring node:', node.name, 'matches exact ignore pattern:', ignoredNames[k]);
        // Still check children but don't include this node
        if ('children' in node) {
          try {
            for (var j = 0; j < node.children.length; j++) {
              findLayersWithRadiusIssues(node.children[j], results, ignoredNames);
            }
          } catch (e) {
            console.log('Error processing children of ignored node', node.name + ':', e.message);
          }
        }
        return results;
      }
    }

    // Check if node has corner radius properties
    if (node.cornerRadius !== undefined || 
        node.topLeftRadius !== undefined || 
        node.topRightRadius !== undefined || 
        node.bottomLeftRadius !== undefined || 
        node.bottomRightRadius !== undefined) {
      
      try {
        var radiusInfo = getDetailedRadiusInfo(node);
        var hasVariable = hasRadiusVariable(node);
        
        console.log('Node:', node.name, 'radiusInfo:', radiusInfo, 'hasVariable:', hasVariable);
        
        // Get the primary radius value for matching (prefer cornerRadius, then first non-zero individual)
        var primaryRadius = 0;
        if (radiusInfo.cornerRadius !== null && radiusInfo.cornerRadius !== 'variable' && radiusInfo.cornerRadius > 0) {
          primaryRadius = radiusInfo.cornerRadius;
        } else if (radiusInfo.hasIndividualCorners) {
          // Find first non-zero individual corner
          var corners = [radiusInfo.topLeftRadius, radiusInfo.topRightRadius, radiusInfo.bottomLeftRadius, radiusInfo.bottomRightRadius];
          for (var m = 0; m < corners.length; m++) {
            if (corners[m] !== null && corners[m] !== 'variable' && corners[m] > 0) {
              primaryRadius = corners[m];
              break;
            }
          }
        }
        
        // Only include if has a radius value > 0 
        if (primaryRadius > 0) {
          var matchingVariable = findMatchingVariable(primaryRadius);
          var issueType = null;
          var suggestion = null;
          var cornerDetails = null;
          
          // Create corner details for partial application
          if (radiusInfo.hasIndividualCorners) {
            cornerDetails = {
              topLeft: radiusInfo.topLeftRadius,
              topRight: radiusInfo.topRightRadius,
              bottomLeft: radiusInfo.bottomLeftRadius,
              bottomRight: radiusInfo.bottomRightRadius,
              hasIndividual: true
            };
          } else {
            cornerDetails = {
              global: radiusInfo.cornerRadius,
              hasIndividual: false
            };
          }
          
          if (!hasVariable && matchingVariable) {
            issueType = 'missing_variable';
            suggestion = {
              type: 'apply_variable',
              variable: matchingVariable,
              message: 'Apply ' + matchingVariable.name + ' (' + matchingVariable.value + 'px)',
              cornerDetails: cornerDetails
            };
          } else if (!hasVariable && !matchingVariable) {
            issueType = 'no_matching_variable';
            suggestion = {
              type: 'no_suggestion',
              message: 'No matching variable found for ' + primaryRadius + 'px',
              cornerDetails: cornerDetails
            };
          } else if (hasVariable) {
            issueType = 'has_variable';
            suggestion = {
              type: 'already_fixed',
              message: 'Already using variable',
              cornerDetails: cornerDetails
            };
          }
          
          if (issueType) {
            results.push({
              id: node.id,
              name: node.name,
              type: node.type,
              radiusValue: primaryRadius,
              hasVariable: hasVariable,
              issueType: issueType,
              matchingVariable: matchingVariable,
              suggestion: suggestion,
              radiusInfo: radiusInfo,
              cornerDetails: cornerDetails
            });
          }
        }
      } catch (e) {
        console.log('Error processing node', node.name + ':', e.message);
        console.log('Error details:', e);
        // Continue processing other nodes
      }
    }

    // Recursively search children
    if ('children' in node) {
      try {
        for (var i = 0; i < node.children.length; i++) {
          findLayersWithRadiusIssues(node.children[i], results, ignoredNames);
        }
      } catch (e) {
        console.log('Error processing children of', node.name + ':', e.message);
      }
    }

  } catch (e) {
    console.log('Error in findLayersWithRadiusIssues for node:', node.name || 'unknown', e.message);
    console.log('Error details:', e);
  }

  return results;
}

// Start scanning process
function startScan(ignoredNames, scanEntirePage) {
  if (isScanning) return;

  console.log('Starting scan with ignored names:', ignoredNames, 'scanEntirePage:', scanEntirePage);
  isScanning = true;
  layersWithIssues = [];
  currentIndex = -1;

  figma.ui.postMessage({
    type: 'scan-started'
  });

  var nodesToScan = [];

  if (scanEntirePage) {
    // Scan entire page
    nodesToScan = figma.currentPage.children;
    console.log('Scanning entire page:', nodesToScan.length, 'top-level nodes');
  } else {
    // Check if we have selected layers
    var selection = figma.currentPage.selection;
    console.log('Current selection:', selection.length, 'layers');

    if (selection.length === 0) {
      figma.ui.postMessage({
        type: 'error',
        message: 'Please select one or more layers to scan'
      });
      isScanning = false;
      return;
    }
    nodesToScan = selection;
  }

  // Find all layers with radius issues
  for (var i = 0; i < nodesToScan.length; i++) {
    console.log('Scanning item:', i, nodesToScan[i].name);
    findLayersWithRadiusIssues(nodesToScan[i], layersWithIssues, ignoredNames);
  }

  console.log('Scan complete. Found', layersWithIssues.length, 'layers with radius values');

  figma.ui.postMessage({
    type: 'scan-complete',
    totalLayers: layersWithIssues.length,
    layers: layersWithIssues.map(function(layer) {
      return {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        radiusValue: layer.radiusValue,
        hasVariable: layer.hasVariable,
        issueType: layer.issueType,
        suggestion: layer.suggestion
      };
    })
  });

  isScanning = false;
}

// Navigate to specific layer
async function navigateToLayer(layerId) {
  console.log('Navigating to layer:', layerId);
  
  // Find the layer in our issues list
  var layerInfo = null;
  for (var i = 0; i < layersWithIssues.length; i++) {
    if (layersWithIssues[i].id === layerId) {
      layerInfo = layersWithIssues[i];
      currentIndex = i;
      break;
    }
  }
  
  if (!layerInfo) {
    console.log('Layer not found in issues list');
    return;
  }

  var node = await figma.getNodeByIdAsync(layerId);
  if (node) {
    figma.viewport.scrollAndZoomIntoView([node]);
    figma.currentPage.selection = [node];

    figma.ui.postMessage({
      type: 'layer-selected',
      layer: {
        id: layerInfo.id,
        name: layerInfo.name,
        type: layerInfo.type,
        radiusValue: layerInfo.radiusValue,
        hasVariable: layerInfo.hasVariable,
        issueType: layerInfo.issueType,
        suggestion: layerInfo.suggestion
      }
    });
  } else {
    figma.ui.postMessage({
      type: 'error',
      message: 'Layer no longer exists'
    });
  }
}

// Apply variable to specific layer
async function applyVariableToLayer(layerId, variableId, applyMode) {
  console.log('Applying variable', variableId, 'to layer', layerId, 'mode:', applyMode);
  
  var node = await figma.getNodeByIdAsync(layerId);
  if (!node) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Layer no longer exists'
    });
    return;
  }

  try {
    var variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) {
      figma.ui.postMessage({
        type: 'error',
        message: 'Variable no longer exists'
      });
      return;
    }

    // Apply variable based on mode
    if (applyMode === 'global' || !applyMode) {
      // Apply to global corner radius (default behavior)
      node.setBoundVariable('cornerRadius', variable);
    } else if (applyMode === 'topOnly') {
      // Apply to top corners only
      node.setBoundVariable('topLeftRadius', variable);
      node.setBoundVariable('topRightRadius', variable);
    } else if (applyMode === 'bottomOnly') {
      // Apply to bottom corners only
      node.setBoundVariable('bottomLeftRadius', variable);
      node.setBoundVariable('bottomRightRadius', variable);
    } else if (applyMode === 'leftOnly') {
      // Apply to left corners only
      node.setBoundVariable('topLeftRadius', variable);
      node.setBoundVariable('bottomLeftRadius', variable);
    } else if (applyMode === 'rightOnly') {
      // Apply to right corners only
      node.setBoundVariable('topRightRadius', variable);
      node.setBoundVariable('bottomRightRadius', variable);
    } else if (applyMode === 'individual') {
      // Apply to all individual corners
      node.setBoundVariable('topLeftRadius', variable);
      node.setBoundVariable('topRightRadius', variable);
      node.setBoundVariable('bottomLeftRadius', variable);
      node.setBoundVariable('bottomRightRadius', variable);
    }
    
    // Update our layer info
    for (var i = 0; i < layersWithIssues.length; i++) {
      if (layersWithIssues[i].id === layerId) {
        layersWithIssues[i].hasVariable = true;
        layersWithIssues[i].issueType = 'has_variable';
        layersWithIssues[i].suggestion = {
          type: 'already_fixed',
          message: 'Already using variable'
        };
        break;
      }
    }

    var modeMessage = '';
    switch (applyMode) {
      case 'topOnly': modeMessage = ' (top corners)'; break;
      case 'bottomOnly': modeMessage = ' (bottom corners)'; break;
      case 'leftOnly': modeMessage = ' (left corners)'; break;
      case 'rightOnly': modeMessage = ' (right corners)'; break;
      case 'individual': modeMessage = ' (all corners)'; break;
      default: modeMessage = ''; break;
    }

    figma.ui.postMessage({
      type: 'variable-applied',
      variableName: variable.name + modeMessage,
      layerName: node.name,
      layerId: layerId
    });

  } catch (e) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to apply variable: ' + e.message
    });
  }
}

// Load ignored names from clientStorage on startup
async function loadIgnoredNames() {
  try {
    var savedNames = await figma.clientStorage.getAsync('borderRadiusChecker_ignoredNames');
    if (savedNames) {
      figma.ui.postMessage({
        type: 'ignored-names-loaded',
        ignoredNames: savedNames
      });
    } else {
      // Set default ignored names if nothing saved
      var defaultNames = ['Labels', 'Label', 'Bracket', 'Instances', 'Instance'];
      await figma.clientStorage.setAsync('borderRadiusChecker_ignoredNames', defaultNames);
      figma.ui.postMessage({
        type: 'ignored-names-loaded',
        ignoredNames: defaultNames
      });
    }
  } catch (e) {
    console.log('Error loading ignored names:', e);
    figma.ui.postMessage({
      type: 'ignored-names-loaded',
      ignoredNames: ['Labels', 'Label', 'Bracket', 'Instances', 'Instance']
    });
  }
}

// Save ignored names to clientStorage
async function saveIgnoredNames(names) {
  try {
    await figma.clientStorage.setAsync('borderRadiusChecker_ignoredNames', names);
    console.log('Saved ignored names to clientStorage:', names);
  } catch (e) {
    console.log('Error saving ignored names:', e);
  }
}

// Load selected collections from clientStorage
async function loadSelectedCollections() {
  try {
    var savedCollections = await figma.clientStorage.getAsync('borderRadiusChecker_selectedCollections');
    if (savedCollections && Array.isArray(savedCollections)) {
      selectedCollectionIds = savedCollections;
      console.log('Loaded selected collections from clientStorage:', selectedCollectionIds);
    }
  } catch (e) {
    console.log('Error loading selected collections:', e);
  }
}

// Save selected collections to clientStorage
async function saveSelectedCollections(collectionIds) {
  try {
    await figma.clientStorage.setAsync('borderRadiusChecker_selectedCollections', collectionIds);
    console.log('Saved selected collections to clientStorage:', collectionIds);
  } catch (e) {
    console.log('Error saving selected collections:', e);
  }
}

// Change the selected collections and reapply filter
function setSelectedCollections(collectionIds) {
  selectedCollectionIds = collectionIds || [];
  saveSelectedCollections(selectedCollectionIds);
  applyCollectionFilter();
}

// Autofix all layers with matching variables
async function autofixAll() {
  console.log('Starting autofix for all layers...');
  
  var fixableLayers = [];
  var totalFixed = 0;
  var totalFailed = 0;
  var failedLayers = [];
  
  // Find all fixable layers
  for (var i = 0; i < layersWithIssues.length; i++) {
    var layer = layersWithIssues[i];
    if (layer.issueType === 'missing_variable' && layer.suggestion && layer.suggestion.type === 'apply_variable') {
      fixableLayers.push(layer);
    }
  }
  
  console.log('Found', fixableLayers.length, 'fixable layers');
  
  // Apply variables to each fixable layer
  for (var j = 0; j < fixableLayers.length; j++) {
    var layerInfo = fixableLayers[j];
    var node = await figma.getNodeByIdAsync(layerInfo.id);
    
    if (!node) {
      totalFailed++;
      failedLayers.push({
        layerName: layerInfo.name,
        reason: 'Layer no longer exists'
      });
      continue;
    }
    
    try {
      var variable = await figma.variables.getVariableByIdAsync(layerInfo.suggestion.variable.id);
      if (!variable) {
        totalFailed++;
        failedLayers.push({
          layerName: layerInfo.name,
          reason: 'Variable no longer exists'
        });
        continue;
      }
      
      // Determine apply mode based on corner details
      var applyMode = 'global';
      if (layerInfo.cornerDetails && layerInfo.cornerDetails.hasIndividual) {
        // If layer has individual corners set, apply to all individual corners
        applyMode = 'individual';
      }
      
      // Apply variable based on mode
      if (applyMode === 'global') {
        node.setBoundVariable('cornerRadius', variable);
      } else if (applyMode === 'individual') {
        // Apply to all individual corners
        node.setBoundVariable('topLeftRadius', variable);
        node.setBoundVariable('topRightRadius', variable);
        node.setBoundVariable('bottomLeftRadius', variable);
        node.setBoundVariable('bottomRightRadius', variable);
      }
      
      // Update layer info
      layerInfo.hasVariable = true;
      layerInfo.issueType = 'has_variable';
      layerInfo.suggestion = {
        type: 'already_fixed',
        message: 'Already using variable'
      };
      
      totalFixed++;
      console.log('Fixed layer:', layerInfo.name);
      
    } catch (e) {
      totalFailed++;
      failedLayers.push({
        layerName: layerInfo.name,
        reason: e.message
      });
      console.log('Failed to fix layer', layerInfo.name + ':', e.message);
    }
  }
  
  console.log('Autofix complete. Fixed:', totalFixed, 'Failed:', totalFailed);
  
  // Send updated layers list to UI
  figma.ui.postMessage({
    type: 'scan-complete',
    totalLayers: layersWithIssues.length,
    layers: layersWithIssues.map(function(layer) {
      return {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        radiusValue: layer.radiusValue,
        hasVariable: layer.hasVariable,
        issueType: layer.issueType,
        suggestion: layer.suggestion
      };
    })
  });
  
  // Send autofix complete message
  figma.ui.postMessage({
    type: 'autofix-complete',
    totalFixed: totalFixed,
    totalFailed: totalFailed,
    failedLayers: failedLayers
  });
}

// Load ignored names on startup
loadIgnoredNames();

// Handle messages from UI
figma.ui.onmessage = function(msg) {
  console.log('Received message:', msg.type);
  
  switch (msg.type) {
    case 'start-scan':
      startScan(msg.ignoredNames || [], false);
      break;

    case 'scan-page':
      startScan(msg.ignoredNames || [], true);
      break;
    
    case 'navigate-to-layer':
      navigateToLayer(msg.layerId);
      break;
    
    case 'apply-variable':
      applyVariableToLayer(msg.layerId, msg.variableId, msg.applyMode);
      break;
    
    case 'rescan-variables':
      scanForBorderRadiusVariables();
      break;

    case 'select-collections':
      setSelectedCollections(msg.collectionIds);
      break;
    
    case 'save-ignored-names':
      saveIgnoredNames(msg.ignoredNames);
      break;
    
    case 'load-ignored-names':
      loadIgnoredNames();
      break;
    
    case 'autofix_all':
      autofixAll();
      break;
    
    case 'close':
      figma.closePlugin();
      break;
  }
};