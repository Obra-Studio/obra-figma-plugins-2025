// code.js
var layersWithIssues = [];
var borderRadiusVariables = [];
var currentIndex = -1;
var isScanning = false;

// Initialize the plugin
figma.showUI(__html__, { width: 450, height: 600 });

// Scan for border radius variables on startup
scanForBorderRadiusVariables();

// Scan for all border radius variables and their values
function scanForBorderRadiusVariables() {
  console.log('Starting variable scan...');
  borderRadiusVariables = [];
  
  try {
    var localVariables = figma.variables.getLocalVariables();
    console.log('Found', localVariables.length, 'total local variables');
    
    for (var i = 0; i < localVariables.length; i++) {
      var variable = localVariables[i];
      
      // Check for corner radius scope
      if (!variable.scopes || variable.scopes.indexOf('CORNER_RADIUS') === -1) {
        continue;
      }
      
      console.log('Found border radius variable:', variable.name);
      
      // Get the variable's numeric value
      var numericValue = null;
      try {
        var collection = figma.variables.getVariableCollectionById(variable.variableCollectionId);
        if (collection && collection.modes && collection.modes.length > 0) {
          var defaultMode = collection.modes[0];
          var valuesByMode = variable.valuesByMode;
          if (valuesByMode && valuesByMode[defaultMode.modeId] !== undefined) {
            var value = valuesByMode[defaultMode.modeId];
            if (typeof value === 'number') {
              numericValue = value;
            }
          }
        }
      } catch (e) {
        console.log('Error getting value for variable', variable.name, ':', e.message);
      }
      
      if (numericValue !== null) {
        borderRadiusVariables.push({
          id: variable.id,
          name: variable.name,
          value: numericValue,
          variable: variable
        });
      }
    }
    
    // Sort variables by their numeric value
    borderRadiusVariables.sort(function(a, b) {
      return a.value - b.value;
    });
    
    console.log('Found', borderRadiusVariables.length, 'border radius variables with values');
    borderRadiusVariables.forEach(function(v) {
      console.log('Variable:', v.name, '=', v.value + 'px');
    });

    figma.ui.postMessage({
      type: 'variables-found',
      variables: borderRadiusVariables.map(function(v) {
        return { 
          id: v.id, 
          name: v.name, 
          value: v.value
        };
      })
    });
    
  } catch (e) {
    console.log('Error scanning variables:', e.message);
    figma.ui.postMessage({
      type: 'variables-found',
      variables: [],
      error: e.message
    });
  }
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
function startScan(ignoredNames) {
  if (isScanning) return;
  
  console.log('Starting scan with ignored names:', ignoredNames);
  isScanning = true;
  layersWithIssues = [];
  currentIndex = -1;

  figma.ui.postMessage({
    type: 'scan-started'
  });

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

  // Find all layers with radius issues in selected layers
  for (var i = 0; i < selection.length; i++) {
    console.log('Scanning selection item:', i, selection[i].name);
    findLayersWithRadiusIssues(selection[i], layersWithIssues, ignoredNames);
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
function navigateToLayer(layerId) {
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

  var node = figma.getNodeById(layerId);
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
function applyVariableToLayer(layerId, variableId, applyMode) {
  console.log('Applying variable', variableId, 'to layer', layerId, 'mode:', applyMode);
  
  var node = figma.getNodeById(layerId);
  if (!node) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Layer no longer exists'
    });
    return;
  }

  try {
    var variable = figma.variables.getVariableById(variableId);
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

// Autofix all layers with matching variables
function autofixAll() {
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
    var node = figma.getNodeById(layerInfo.id);
    
    if (!node) {
      totalFailed++;
      failedLayers.push({
        layerName: layerInfo.name,
        reason: 'Layer no longer exists'
      });
      continue;
    }
    
    try {
      var variable = figma.variables.getVariableById(layerInfo.suggestion.variable.id);
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
      startScan(msg.ignoredNames || []);
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