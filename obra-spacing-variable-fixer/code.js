// code.js
var layersWithIssues = [];
var spacingVariables = [];
var currentIndex = -1;
var isScanning = false;

// Initialize the plugin
figma.showUI(__html__, { width: 450, height: 600 });

// Scan for spacing variables on startup
scanForSpacingVariables();

// Scan for all spacing variables and their values
function scanForSpacingVariables() {
  console.log('Starting variable scan...');
  spacingVariables = [];
  
  try {
    var localVariables = figma.variables.getLocalVariables();
    console.log('Found', localVariables.length, 'total local variables');
    
    for (var i = 0; i < localVariables.length; i++) {
      var variable = localVariables[i];
      
      // Check for GAP or WIDTH_HEIGHT scope (both can be used for spacing)
      if (!variable.scopes || (variable.scopes.indexOf('GAP') === -1 && variable.scopes.indexOf('WIDTH_HEIGHT') === -1)) {
        continue;
      }
      
      console.log('Found spacing variable:', variable.name);
      
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
        spacingVariables.push({
          id: variable.id,
          name: variable.name,
          value: numericValue,
          variable: variable,
          scopes: variable.scopes
        });
      }
    }
    
    // Sort variables by their numeric value
    spacingVariables.sort(function(a, b) {
      return a.value - b.value;
    });
    
    console.log('Found', spacingVariables.length, 'spacing variables with values');
    spacingVariables.forEach(function(v) {
      console.log('Variable:', v.name, '=', v.value + 'px');
    });

    figma.ui.postMessage({
      type: 'variables-found',
      variables: spacingVariables.map(function(v) {
        return { 
          id: v.id, 
          name: v.name, 
          value: v.value,
          scopes: v.scopes
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

// Find matching variable for a given spacing value
function findMatchingVariable(spacingValue, propertyType) {
  // propertyType can be 'gap' or 'padding' to help match correct scope
  for (var i = 0; i < spacingVariables.length; i++) {
    if (spacingVariables[i].value === spacingValue) {
      // Check if the variable has appropriate scope for the property
      var hasGapScope = spacingVariables[i].scopes.indexOf('GAP') !== -1;
      var hasWidthHeightScope = spacingVariables[i].scopes.indexOf('WIDTH_HEIGHT') !== -1;
      
      // GAP scope is for gaps, WIDTH_HEIGHT can be used for padding
      if (propertyType === 'gap' && hasGapScope) {
        return spacingVariables[i];
      } else if (propertyType === 'padding' && hasWidthHeightScope) {
        return spacingVariables[i];
      } else if (hasGapScope || hasWidthHeightScope) {
        // If no specific match, return any matching value
        return spacingVariables[i];
      }
    }
  }
  return null;
}

// Check if node has any spacing bound variables
function hasSpacingVariable(node) {
  try {
    if (!node.boundVariables) return false;
    
    var spacingProperties = ['itemSpacing', 'counterAxisSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
    
    for (var i = 0; i < spacingProperties.length; i++) {
      var prop = spacingProperties[i];
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
    console.log('Error checking for spacing variables on node', node.name + ':', e.message);
    return false;
  }
}

// Get detailed spacing information from a node
function getDetailedSpacingInfo(node) {
  console.log('Getting detailed spacing info for node:', node.name);
  
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
  
  // Note: horizontalPadding and verticalPadding are deprecated, using individual padding only"
  
  // Check if gap has variable
  if (spacingInfo.itemSpacing === 'variable' || spacingInfo.counterAxisSpacing === 'variable') {
    spacingInfo.hasVariables = true;
  }
  
  spacingInfo.hasIndividualPadding = hasNonZeroIndividual || hasVariableIndividual;
  
  console.log('Detailed spacing info:', spacingInfo);
  return spacingInfo;
}

// Recursively find layers with spacing issues
function findLayersWithSpacingIssues(node, results, ignoredNames) {
  results = results || [];
  ignoredNames = ignoredNames || [];

  try {
    console.log('Checking node:', node.name, 'type:', node.type);

    // Always ignore COMPONENT_SET layers (component variants)
    if (node.type === 'COMPONENT_SET') {
      console.log('Ignoring COMPONENT_SET:', node.name);
      // Still check children but don't include this node
      if ('children' in node) {
        try {
          for (var j = 0; j < node.children.length; j++) {
            findLayersWithSpacingIssues(node.children[j], results, ignoredNames);
          }
        } catch (e) {
          console.log('Error processing children of COMPONENT_SET', node.name + ':', e.message);
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
              findLayersWithSpacingIssues(node.children[j], results, ignoredNames);
            }
          } catch (e) {
            console.log('Error processing children of ignored node', node.name + ':', e.message);
          }
        }
        return results;
      }
    }

    // Check if node has spacing properties (auto-layout with gap or padding)
    var hasCounterAxisSpacing = node.layoutWrap === 'WRAP' && node.counterAxisSpacing !== undefined;
    var hasAutoLayoutSpacing = (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL') && 
                               (node.itemSpacing !== undefined || hasCounterAxisSpacing);
    var hasPadding = node.paddingTop !== undefined || 
                     node.paddingRight !== undefined || 
                     node.paddingBottom !== undefined || 
                     node.paddingLeft !== undefined;
    
    if (hasAutoLayoutSpacing || hasPadding) {
      
      try {
        var spacingInfo = getDetailedSpacingInfo(node);
        var hasVariable = hasSpacingVariable(node);
        
        console.log('Node:', node.name, 'spacingInfo:', spacingInfo, 'hasVariable:', hasVariable);
        
        // Collect all spacing values that need checking
        var spacingIssues = [];
        
        // Check gap/itemSpacing - but skip if using auto-spacing (SPACE_BETWEEN)
        var isAutoSpaced = node.primaryAxisAlignItems === 'SPACE_BETWEEN';
        
        console.log('Node:', node.name, 'layoutMode:', node.layoutMode, 'layoutWrap:', node.layoutWrap, 'primaryAxisAlignItems:', node.primaryAxisAlignItems, 'itemSpacing:', node.itemSpacing, 'counterAxisSpacing:', node.counterAxisSpacing, 'children:', node.children ? node.children.length : 0, 'isAutoSpaced:', isAutoSpaced);
        
        if (isAutoSpaced) {
          console.log('Skipping gap check for', node.name, '- using auto spacing (SPACE_BETWEEN)');
        }
        
        // Only check for gaps if auto-layout is actually enabled
        var hasAutoLayout = node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL';
        
        if (hasAutoLayout && !isAutoSpaced && spacingInfo.itemSpacing !== null && spacingInfo.itemSpacing !== 'variable' && spacingInfo.itemSpacing > 0) {
          spacingIssues.push({
            type: 'gap',
            value: spacingInfo.itemSpacing,
            property: 'itemSpacing'
          });
        }
        
        // Check counterAxisSpacing (cross-axis gap for wrapped auto-layout)
        // Only applies when layoutWrap is "WRAP" AND auto-layout is enabled
        // When counterAxisSpacing is null, it syncs with itemSpacing, so we skip it
        if (hasAutoLayout && node.layoutWrap === 'WRAP' && spacingInfo.counterAxisSpacing !== null && spacingInfo.counterAxisSpacing !== 'variable' && spacingInfo.counterAxisSpacing > 0) {
          spacingIssues.push({
            type: 'gap',
            value: spacingInfo.counterAxisSpacing,
            property: 'counterAxisSpacing'
          });
        }
        
        // Check padding values - but avoid double-tracking since horizontalPadding/verticalPadding 
        // are deprecated and we apply to individual padding properties anyway
        if (spacingInfo.hasIndividualPadding) {
          // Check individual padding values only
          var paddingProps = [
            {prop: 'paddingTop', value: spacingInfo.paddingTop},
            {prop: 'paddingRight', value: spacingInfo.paddingRight},
            {prop: 'paddingBottom', value: spacingInfo.paddingBottom},
            {prop: 'paddingLeft', value: spacingInfo.paddingLeft}
          ];
          
          for (var p = 0; p < paddingProps.length; p++) {
            if (paddingProps[p].value !== null && paddingProps[p].value !== 'variable' && paddingProps[p].value > 0) {
              spacingIssues.push({
                type: 'padding',
                value: paddingProps[p].value,
                property: paddingProps[p].prop
              });
            }
          }
        }
        
        // Process each spacing issue found
        for (var s = 0; s < spacingIssues.length; s++) {
          var issue = spacingIssues[s];
          var matchingVariable = findMatchingVariable(issue.value, issue.type);
          var issueType = null;
          var suggestion = null;
          
          // Check if THIS specific property has a variable bound
          var hasPropertyVariable = false;
          try {
            if (node.boundVariables && node.boundVariables[issue.property]) {
              hasPropertyVariable = true;
              console.log('Found bound variable for', issue.property, 'on node', node.name);
            }
          } catch (e) {
            console.log('Error checking bound variable for', issue.property + ':', e.message);
          }
          
          // Determine issue type and suggestion based on THIS property's variable state
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
          
          // Add the issue regardless of variable state (for tracking purposes)
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
        
        // Note: Individual properties with variables are now tracked in the loop above
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
          findLayersWithSpacingIssues(node.children[i], results, ignoredNames);
        }
      } catch (e) {
        console.log('Error processing children of', node.name + ':', e.message);
      }
    }

  } catch (e) {
    console.log('Error in findLayersWithSpacingIssues for node:', node.name || 'unknown', e.message);
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

  // Find all layers with spacing issues in selected layers
  for (var i = 0; i < selection.length; i++) {
    console.log('Scanning selection item:', i, selection[i].name);
    findLayersWithSpacingIssues(selection[i], layersWithIssues, ignoredNames);
  }

  console.log('Scan complete. Found', layersWithIssues.length, 'layers with spacing values');

  figma.ui.postMessage({
    type: 'scan-complete',
    totalLayers: layersWithIssues.length,
    layers: layersWithIssues.map(function(layer) {
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
        spacingValue: layerInfo.spacingValue,
        spacingProperty: layerInfo.spacingProperty,
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
function applyVariableToLayer(layerId, variableId, applyMode, propertyName) {
  console.log('Applying variable', variableId, 'to layer', layerId, 'mode:', applyMode, 'property:', propertyName);
  
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

    // Apply variable based on the property name or mode
    if (propertyName) {
      // Direct property application
      if (propertyName === 'itemSpacing') {
        node.setBoundVariable('itemSpacing', variable);
      } else if (propertyName === 'counterAxisSpacing') {
        node.setBoundVariable('counterAxisSpacing', variable);
      } else if (propertyName === 'horizontalPadding') {
        // Apply to left and right padding for horizontal
        node.setBoundVariable('paddingLeft', variable);
        node.setBoundVariable('paddingRight', variable);
      } else if (propertyName === 'verticalPadding') {
        // Apply to top and bottom padding for vertical
        node.setBoundVariable('paddingTop', variable);
        node.setBoundVariable('paddingBottom', variable);
      } else if (propertyName === 'paddingTop') {
        node.setBoundVariable('paddingTop', variable);
      } else if (propertyName === 'paddingRight') {
        node.setBoundVariable('paddingRight', variable);
      } else if (propertyName === 'paddingBottom') {
        node.setBoundVariable('paddingBottom', variable);
      } else if (propertyName === 'paddingLeft') {
        node.setBoundVariable('paddingLeft', variable);
      }
    } else if (applyMode) {
      // Apply based on mode for padding
      if (applyMode === 'allPadding') {
        // Apply to all padding values
        node.setBoundVariable('paddingTop', variable);
        node.setBoundVariable('paddingRight', variable);
        node.setBoundVariable('paddingBottom', variable);
        node.setBoundVariable('paddingLeft', variable);
      } else if (applyMode === 'horizontalOnly') {
        // Apply to horizontal padding
        node.setBoundVariable('paddingLeft', variable);
        node.setBoundVariable('paddingRight', variable);
      } else if (applyMode === 'verticalOnly') {
        // Apply to vertical padding
        node.setBoundVariable('paddingTop', variable);
        node.setBoundVariable('paddingBottom', variable);
      } else if (applyMode === 'uniformPadding') {
        // Apply to uniform padding if available
        if (node.horizontalPadding !== undefined) {
          node.setBoundVariable('horizontalPadding', variable);
        }
        if (node.verticalPadding !== undefined) {
          node.setBoundVariable('verticalPadding', variable);
        }
      }
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
    if (propertyName) {
      if (propertyName === 'horizontalPadding') {
        modeMessage = ' to horizontal padding (left & right)';
      } else if (propertyName === 'verticalPadding') {
        modeMessage = ' to vertical padding (top & bottom)';
      } else {
        modeMessage = ' to ' + propertyName;
      }
    } else if (applyMode) {
      switch (applyMode) {
        case 'allPadding': modeMessage = ' (all padding)'; break;
        case 'horizontalOnly': modeMessage = ' (horizontal padding)'; break;
        case 'verticalOnly': modeMessage = ' (vertical padding)'; break;
        case 'uniformPadding': modeMessage = ' (uniform padding)'; break;
        default: modeMessage = ''; break;
      }
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

// Apply variables to all fixable layers at once
function autofixAllLayers() {
  console.log('Starting autofix for all layers...');
  
  // Get current layers with issues
  var currentLayers = layersWithIssues.slice(); // Create a copy to avoid modification issues
  var fixedLayers = [];
  var failedLayers = [];
  
  for (var i = 0; i < currentLayers.length; i++) {
    var layer = currentLayers[i];
    
    // Only attempt to fix layers that have actionable suggestions
    if (layer.issueType === 'missing_variable' && 
        layer.suggestion && 
        layer.suggestion.type === 'apply_variable') {
      
      try {
        var node = figma.getNodeById(layer.id);
        if (!node) {
          failedLayers.push({
            layerName: layer.name,
            reason: 'Layer not found'
          });
          continue;
        }
        
        var variable = figma.variables.getVariableById(layer.suggestion.variable.id);
        if (!variable) {
          failedLayers.push({
            layerName: layer.name,
            reason: 'Variable not found'
          });
          continue;
        }
        
        var propertyName = layer.suggestion.property || layer.spacingProperty;
        
        // Apply the variable
        if (propertyName === 'itemSpacing') {
          node.setBoundVariable('itemSpacing', variable);
        } else if (propertyName === 'counterAxisSpacing') {
          node.setBoundVariable('counterAxisSpacing', variable);
        } else if (propertyName === 'horizontalPadding') {
          // Apply to left and right padding for horizontal
          node.setBoundVariable('paddingLeft', variable);
          node.setBoundVariable('paddingRight', variable);
        } else if (propertyName === 'verticalPadding') {
          // Apply to top and bottom padding for vertical
          node.setBoundVariable('paddingTop', variable);
          node.setBoundVariable('paddingBottom', variable);
        } else if (['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].indexOf(propertyName) !== -1) {
          node.setBoundVariable(propertyName, variable);
        }
        
        fixedLayers.push({
          layerName: layer.name,
          variableName: variable.name,
          property: propertyName
        });
        
        console.log('Fixed layer:', layer.name, 'with variable:', variable.name);
        
      } catch (error) {
        console.error('Error fixing layer:', layer.name, error);
        failedLayers.push({
          layerName: layer.name,
          reason: error.message
        });
      }
    }
  }
  
  // Send results back to UI
  figma.ui.postMessage({
    type: 'autofix-complete',
    fixedLayers: fixedLayers,
    failedLayers: failedLayers,
    totalFixed: fixedLayers.length,
    totalFailed: failedLayers.length
  });
  
  // Rescan to update the UI
  setTimeout(function() {
    scanForSpacingVariables();
  }, 100);
}

// Load ignored names from clientStorage on startup
async function loadIgnoredNames() {
  try {
    var savedNames = await figma.clientStorage.getAsync('spacingChecker_ignoredNames');
    if (savedNames) {
      figma.ui.postMessage({
        type: 'ignored-names-loaded',
        ignoredNames: savedNames
      });
    } else {
      // Set default ignored names if nothing saved
      var defaultNames = ['Labels', 'Label', 'Bracket', 'Instances', 'Instance'];
      await figma.clientStorage.setAsync('spacingChecker_ignoredNames', defaultNames);
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
    await figma.clientStorage.setAsync('spacingChecker_ignoredNames', names);
    console.log('Saved ignored names to clientStorage:', names);
  } catch (e) {
    console.log('Error saving ignored names:', e);
  }
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
      applyVariableToLayer(msg.layerId, msg.variableId, msg.applyMode, msg.propertyName);
      break;
    
    case 'rescan-variables':
      scanForSpacingVariables();
      break;
    
    case 'save-ignored-names':
      saveIgnoredNames(msg.ignoredNames);
      break;
    
    case 'load-ignored-names':
      loadIgnoredNames();
      break;
    
    case 'autofix_all':
      autofixAllLayers();
      break;
    
    case 'close':
      figma.closePlugin();
      break;
  }
};