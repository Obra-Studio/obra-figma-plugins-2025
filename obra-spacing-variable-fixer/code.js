// code.js
var layersWithIssues = [];
var spacingVariables = [];
var variableCollections = [];
var selectedCollectionIds = []; // Ordered array: earlier = preferred rank. Empty = no filter (all)
var currentIndex = -1;
var isScanning = false;

// Initialize the plugin
figma.showUI(__html__, { width: 450, height: 600 });

// Load selected collections first, then scan for variables
loadSelectedCollections().then(function() {
  scanForSpacingVariables();
});

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
    // Wait for the document to be ready for dynamic pages
    await figma.loadAllPagesAsync();

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

      // Debug: log variables with spacing-related names
      var nameLower = variable.name.toLowerCase();
      if (nameLower.indexOf('xl') !== -1 || nameLower.indexOf('lg') !== -1 ||
          nameLower.indexOf('md') !== -1 || nameLower.indexOf('sm') !== -1 ||
          nameLower.indexOf('spacing') !== -1 || nameLower.indexOf('gap') !== -1) {
        console.log('DEBUG spacing-named variable:', variable.name, 'scopes:', variable.scopes, 'resolvedType:', variable.resolvedType);
      }

      // Check for GAP, WIDTH_HEIGHT, or ALL_SCOPES (default when designer hasn't set specific scopes)
      var hasGap = variable.scopes && variable.scopes.indexOf('GAP') !== -1;
      var hasWidthHeight = variable.scopes && variable.scopes.indexOf('WIDTH_HEIGHT') !== -1;
      var hasAllScopes = variable.scopes && variable.scopes.indexOf('ALL_SCOPES') !== -1;

      if (!variable.scopes || (!hasGap && !hasWidthHeight && !hasAllScopes)) {
        // Log why this variable is being skipped
        if (nameLower.indexOf('xl') !== -1 || nameLower.indexOf('lg') !== -1 ||
            nameLower.indexOf('md') !== -1 || nameLower.indexOf('spacing') !== -1) {
          console.log('SKIPPING variable (wrong scope):', variable.name, 'scopes:', variable.scopes);
        }
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
    spacingVariables.forEach(function(v) {
      console.log('Variable:', v.name, '=', v.value + 'px', 'collection:', v.collectionName);
    });

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
function startScan(ignoredNames, scanEntirePage) {
  if (isScanning) return;

  console.log('Starting scan, scanEntirePage:', scanEntirePage);
  isScanning = true;
  layersWithIssues = [];
  currentIndex = -1;

  figma.ui.postMessage({
    type: 'scan-started'
  });

  var nodesToScan = [];

  if (scanEntirePage) {
    nodesToScan = figma.currentPage.children;
  } else {
    var selection = figma.currentPage.selection;
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

  for (var i = 0; i < nodesToScan.length; i++) {
    findLayersWithSpacingIssues(nodesToScan[i], layersWithIssues, ignoredNames);
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
async function applyVariableToLayer(layerId, variableId, applyMode, propertyName) {
  console.log('Applying variable', variableId, 'to layer', layerId, 'mode:', applyMode, 'property:', propertyName);
  
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
async function autofixAllLayers() {
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
        var node = await figma.getNodeByIdAsync(layer.id);
        if (!node) {
          failedLayers.push({
            layerName: layer.name,
            reason: 'Layer not found'
          });
          continue;
        }
        
        var variable = await figma.variables.getVariableByIdAsync(layer.suggestion.variable.id);
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
  setTimeout(async function() {
    await scanForSpacingVariables();
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
figma.ui.onmessage = async function(msg) {
  console.log('Received message:', msg.type);

  switch (msg.type) {
    case 'start-scan':
      startScan(msg.ignoredNames || [], false);
      break;

    case 'scan-page':
      startScan(msg.ignoredNames || [], true);
      break;

    case 'scan-file':
      await scanEntireFile(msg.ignoredNames || []);
      break;

    case 'go-to-page':
      await goToPage(msg.pageId);
      break;

    case 'clear-file-scan':
      await clearLastFileScan();
      break;

    case 'navigate-to-layer':
      await navigateToLayer(msg.layerId);
      break;

    case 'apply-variable':
      await applyVariableToLayer(msg.layerId, msg.variableId, msg.applyMode, msg.propertyName);
      break;

    case 'rescan-variables':
      await scanForSpacingVariables();
      break;

    case 'save-ignored-names':
      await saveIgnoredNames(msg.ignoredNames);
      break;

    case 'load-ignored-names':
      await loadIgnoredNames();
      break;

    case 'autofix_all':
      await autofixAllLayers();
      break;

    case 'select-collections':
      setSelectedCollections(msg.collectionIds);
      break;

    case 'close':
      figma.closePlugin();
      break;
  }
};

// Load selected collections from clientStorage
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

// Storage key scoped to this Figma file
function getFileScanStorageKey() {
  var fileId = (figma.fileKey || (figma.root && figma.root.id) || 'unknown');
  return 'spacingChecker_lastFileScan_' + fileId;
}

async function scanEntireFile(ignoredNames) {
  ignoredNames = ignoredNames || [];
  figma.ui.postMessage({ type: 'file-scan-started' });

  try {
    await figma.loadAllPagesAsync();
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: 'Failed to load all pages: ' + e.message });
    return;
  }

  var pages = figma.root.children;
  var pageResults = [];

  for (var p = 0; p < pages.length; p++) {
    var page = pages[p];
    var issues = [];
    try {
      for (var c = 0; c < page.children.length; c++) {
        findLayersWithSpacingIssues(page.children[c], issues, ignoredNames);
      }
    } catch (e) {
      console.log('Error scanning page', page.name + ':', e.message);
    }

    var fixable = 0, noMatch = 0, alreadyFixed = 0;
    for (var i = 0; i < issues.length; i++) {
      if (issues[i].issueType === 'missing_variable') fixable++;
      else if (issues[i].issueType === 'no_matching_variable') noMatch++;
      else if (issues[i].issueType === 'has_variable') alreadyFixed++;
    }

    pageResults.push({
      id: page.id,
      name: page.name,
      total: issues.length,
      fixable: fixable,
      noMatch: noMatch,
      alreadyFixed: alreadyFixed,
      problems: fixable + noMatch
    });

    figma.ui.postMessage({
      type: 'file-scan-progress',
      current: p + 1,
      total: pages.length,
      pageName: page.name
    });

    await new Promise(function(resolve) { setTimeout(resolve, 0); });
  }

  pageResults.sort(function(a, b) { return b.problems - a.problems; });

  var payload = { pages: pageResults, scannedAt: Date.now() };

  try {
    await figma.clientStorage.setAsync(getFileScanStorageKey(), payload);
  } catch (e) {
    console.log('Error saving file scan results:', e.message);
  }

  figma.ui.postMessage({
    type: 'file-scan-complete',
    pages: pageResults,
    scannedAt: payload.scannedAt
  });
}

async function loadLastFileScan() {
  try {
    var saved = await figma.clientStorage.getAsync(getFileScanStorageKey());
    if (saved && saved.pages) {
      figma.ui.postMessage({
        type: 'file-scan-restored',
        pages: saved.pages,
        scannedAt: saved.scannedAt
      });
    }
  } catch (e) {
    console.log('Error loading saved file scan:', e.message);
  }
}

async function clearLastFileScan() {
  try {
    await figma.clientStorage.deleteAsync(getFileScanStorageKey());
  } catch (e) {
    console.log('Error clearing saved file scan:', e.message);
  }
}

async function goToPage(pageId) {
  try {
    var page = await figma.getNodeByIdAsync(pageId);
    if (page && page.type === 'PAGE') {
      await figma.setCurrentPageAsync(page);
      figma.ui.postMessage({ type: 'page-changed', pageId: pageId, pageName: page.name });
    }
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: 'Failed to switch page: ' + e.message });
  }
}

loadLastFileScan();