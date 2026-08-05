// Show the plugin UI with Figma's theme colors enabled
figma.showUI(__html__, { width: 480, height: 600, themeColors: true });

// Store collections and variables data
let collectionsData = [];

// Cooperative cancellation: long-running operations (merge/split/move) poll
// this flag at each yield point instead of being force-killed. A hard
// figma.closePlugin() mid-mutation can't be undone and can't distinguish
// "half-rewired" state from "fully done", so we never do that for an
// in-progress operation.
let cancelRequested = false;

// Distinguishes "Cancel" meaning "stop the running operation" (cooperative,
// via cancelRequested) from "Cancel" meaning "close this idle dialog" (the
// same button/message serves both — see figma.ui.onmessage's 'cancel' case).
let operationRunning = false;

// Yield control back to the event loop. Without periodic yields, a long
// synchronous loop (e.g. rewiring bindings across every node on every page)
// never gives figma.ui.onmessage a chance to run, so incoming 'cancel'
// messages queue up and do nothing until the loop finishes on its own — and
// outgoing progress messages can appear to stall for the same reason. Insert
// this between chunks of work, not inside tight per-property loops.
function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Initialize plugin by loading all variable collections
async function loadCollections() {
  try {
    // Use the async method to get all local variable collections
    const allCollections = await figma.variables.getLocalVariableCollectionsAsync();

    // Deduplicate collections by ID (in case API returns duplicates)
    const seenIds = new Set();
    const collections = allCollections.filter(c => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    });

    collectionsData = [];

    for (const collection of collections) {
      const variables = [];
      
      // Iterate through variable IDs in the collection
      for (const variableId of collection.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (variable) {
          variables.push({
            id: variable.id,
            name: variable.name,
            resolvedType: variable.resolvedType,
            valuesByMode: variable.valuesByMode,
            scopes: variable.scopes,
            hiddenFromPublishing: variable.hiddenFromPublishing,
            description: variable.description,
            codeSyntax: variable.codeSyntax
          });
        }
      }

      collectionsData.push({
        id: collection.id,
        name: collection.name,
        modes: collection.modes,
        defaultModeId: collection.defaultModeId,
        variableCount: variables.length,
        variables: variables
      });
    }

    // Send data to UI
    figma.ui.postMessage({
      type: 'collections-loaded',
      collections: collectionsData
    });

  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to load collections: ' + error.message
    });
  }
}

// Merge variables from source collections into target collection
async function mergeCollections(targetCollectionId, sourceCollectionIds, deleteSourceCollections, groupByCollection, fillMissingModes, newTargetName, groupTargetVariables) {
  operationRunning = true;
  try {
    const targetCollection = await figma.variables.getVariableCollectionByIdAsync(targetCollectionId);
    
    if (!targetCollection) {
      throw new Error('Target collection not found');
    }

    let movedCount = 0;
    const errors = [];
    
    // Store original target collection name for grouping existing variables
    const originalTargetName = targetCollection.name;

    // PHASE 0: Rename existing target variables to add group prefix (if enabled)
    if (groupTargetVariables && originalTargetName) {
      const existingVariableIds = [...targetCollection.variableIds];
      sendProgress(`Grouping existing "${originalTargetName}" variables… (0/${existingVariableIds.length})`, {
        phase: 'prepare', current: 0, total: existingVariableIds.length
      });

      for (let vi = 0; vi < existingVariableIds.length; vi++) {
        const variable = await figma.variables.getVariableByIdAsync(existingVariableIds[vi]);
        if (variable) {
          try {
            // Add the original collection name as a group prefix
            variable.name = originalTargetName + '/' + variable.name;
          } catch (renameError) {
            errors.push(`Failed to rename existing variable "${variable.name}": ${renameError.message}`);
          }
        }

        if (vi > 0 && vi % 50 === 0) {
          sendProgress(`Grouping existing "${originalTargetName}" variables… (${vi}/${existingVariableIds.length})`, {
            phase: 'prepare', current: vi, total: existingVariableIds.length
          });
          await yieldToUI();
        }
      }
    }

    // Rename the target collection if a new name is provided
    if (newTargetName && newTargetName !== originalTargetName) {
      try {
        targetCollection.name = newTargetName;
      } catch (renameError) {
        errors.push(`Failed to rename collection: ${renameError.message}`);
      }
    }

    // Map to track old variable ID -> new variable ID for alias resolution
    const variableIdMap = new Map();
    
    // Store variables that have aliases to process in a second pass
    const variablesWithAliases = [];

    // Get target collection's modes for mapping
    const targetModes = targetCollection.modes;

    // PHASE 1: Create all new variables and collect alias information
    // We need to do this in two passes because aliases might reference variables
    // that haven't been created yet
    
    for (const sourceCollectionId of sourceCollectionIds) {
      const sourceCollection = await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);
      
      if (!sourceCollection) {
        errors.push(`Source collection ${sourceCollectionId} not found`);
        continue;
      }

      const sourceModes = sourceCollection.modes;
      const variableIds = [...sourceCollection.variableIds];
      const groupPrefix = groupByCollection ? sourceCollection.name + '/' : '';

      sendProgress(`Creating variables from "${sourceCollection.name}"… (0/${variableIds.length})`, {
        phase: 'create', current: 0, total: variableIds.length
      });

      for (let vi = 0; vi < variableIds.length; vi++) {
        const variableId = variableIds[vi];
        const sourceVariable = await figma.variables.getVariableByIdAsync(variableId);

        if (vi > 0 && vi % 25 === 0) {
          sendProgress(`Creating variables from "${sourceCollection.name}"… (${vi}/${variableIds.length})`, {
            phase: 'create', current: vi, total: variableIds.length
          });
          await yieldToUI();
        }

        if (!sourceVariable) {
          continue;
        }

        try {
          // Create new variable in target collection
          // If groupByCollection is enabled, prefix the name with the source collection name
          // Using slash notation creates a group in Figma (e.g., "Colors/primary" creates a "Colors" group)
          const newVariableName = groupPrefix + sourceVariable.name;
          
          const newVariable = figma.variables.createVariable(
            newVariableName,
            targetCollection,
            sourceVariable.resolvedType
          );

          // Store the mapping from old ID to new variable
          variableIdMap.set(sourceVariable.id, newVariable);

          // Track alias info for second pass
          const aliasInfo = {
            newVariable: newVariable,
            sourceVariable: sourceVariable,
            sourceModes: sourceModes,
            hasAliases: false
          };

          // Process each mode's value
          // Get the first mode's value to use as fallback for missing modes
          const firstModeValue = sourceVariable.valuesByMode[sourceModes[0].modeId];
          
          for (let i = 0; i < targetModes.length; i++) {
            const targetMode = targetModes[i];
            const sourceMode = sourceModes[i]; // May be undefined if source has fewer modes
            
            let sourceValue;
            
            if (sourceMode) {
              // Source has this mode, use its value
              sourceValue = sourceVariable.valuesByMode[sourceMode.modeId];
            } else if (fillMissingModes && firstModeValue !== undefined) {
              // Source doesn't have this mode, but we should fill from first mode
              sourceValue = firstModeValue;
            } else {
              // No value available for this mode
              continue;
            }
            
            if (sourceValue === undefined) {
              continue;
            }

            // Check if this is a variable alias
            if (isVariableAlias(sourceValue)) {
              aliasInfo.hasAliases = true;
              // Store which target modes need alias resolution
              if (!aliasInfo.targetModesToFill) {
                aliasInfo.targetModesToFill = [];
              }
              aliasInfo.targetModesToFill.push({
                targetModeId: targetMode.modeId,
                sourceValue: sourceValue
              });
            } else {
              // It's a raw value, set it directly
              newVariable.setValueForMode(targetMode.modeId, sourceValue);
            }
          }

          // If this variable has any aliases, save for second pass
          if (aliasInfo.hasAliases) {
            variablesWithAliases.push(aliasInfo);
          }

          // Copy description if it exists
          if (sourceVariable.description) {
            newVariable.description = sourceVariable.description;
          }
          
          // Copy hiddenFromPublishing property
          if (sourceVariable.hiddenFromPublishing !== undefined) {
            newVariable.hiddenFromPublishing = sourceVariable.hiddenFromPublishing;
          }

          // Copy scopes
          if (sourceVariable.scopes && sourceVariable.scopes.length > 0) {
            newVariable.scopes = sourceVariable.scopes;
          }

          // Copy code syntax definitions
          if (sourceVariable.codeSyntax) {
            for (const [platform, syntax] of Object.entries(sourceVariable.codeSyntax)) {
              if (syntax) {
                newVariable.setVariableCodeSyntax(platform, syntax);
              }
            }
          }

          movedCount++;

        } catch (varError) {
          errors.push(`Failed to create variable "${sourceVariable.name}": ${varError.message}`);
        }
      }
    }

    // PHASE 2: Resolve all aliases now that all variables exist
    for (const aliasInfo of variablesWithAliases) {
      const { newVariable, sourceVariable, targetModesToFill } = aliasInfo;

      if (!targetModesToFill) continue;

      for (const { targetModeId, sourceValue } of targetModesToFill) {
        if (isVariableAlias(sourceValue)) {
          try {
            // sourceValue.id contains the ID of the referenced variable
            const referencedVariableId = sourceValue.id;
            
            // Check if the referenced variable was also moved (in our map)
            const newReferencedVariable = variableIdMap.get(referencedVariableId);
            
            if (newReferencedVariable) {
              // Create a new alias pointing to the new variable
              const newAlias = figma.variables.createVariableAlias(newReferencedVariable);
              newVariable.setValueForMode(targetModeId, newAlias);
            } else {
              // The referenced variable wasn't moved - it might be in target collection already
              // or in a collection we're not touching. Try to use the original reference.
              const originalRef = await figma.variables.getVariableByIdAsync(referencedVariableId);
              
              if (originalRef) {
                // Check if it's in the target collection
                if (originalRef.variableCollectionId === targetCollectionId) {
                  // It's already in target, create alias to it
                  const newAlias = figma.variables.createVariableAlias(originalRef);
                  newVariable.setValueForMode(targetModeId, newAlias);
                } else {
                  // It's in another collection (not being merged), keep the reference
                  newVariable.setValueForMode(targetModeId, sourceValue);
                }
              } else {
                // Original variable doesn't exist, this shouldn't normally happen
                errors.push(`Alias in "${sourceVariable.name}" references non-existent variable`);
              }
            }
          } catch (aliasError) {
            errors.push(`Failed to resolve alias in "${sourceVariable.name}": ${aliasError.message}`);
          }
        }
      }
    }

    // PHASE 2.5: Update backreferences in other collections
    await updateBackreferences(variableIdMap, errors);

    // PHASE 2.6: Rewire design-node bindings (fills/strokes/effects/etc.)
    // so that nodes using the moved variables don't lose their binding when
    // the source variable is removed below.
    await updateDesignNodeBindings(variableIdMap, errors);

    // PHASE 3: Remove source variables and optionally delete collections.
    // Skipped entirely if the rebind pass above was cancelled partway —
    // deleting a source variable that some node is still bound to would
    // leave that node with a dangling/missing variable reference.
    if (cancelRequested) {
      errors.push('Operation cancelled — original variables and collections were left in place (new variables in the target collection were already created and are safe to keep or delete manually).');
    } else {
      sendProgress('Removing old variables…');
      for (const sourceCollectionId of sourceCollectionIds) {
        const sourceCollection = await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);

        if (!sourceCollection) continue;

        // Remove all source variables
        const variableIds = [...sourceCollection.variableIds];
        for (const variableId of variableIds) {
          const sourceVariable = await figma.variables.getVariableByIdAsync(variableId);
          if (sourceVariable) {
            try {
              sourceVariable.remove();
            } catch (removeError) {
              errors.push(`Failed to remove original variable: ${removeError.message}`);
            }
          }
        }

        // Delete source collection if requested and empty
        if (deleteSourceCollections) {
          try {
            const updatedSourceCollection = await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);
            if (updatedSourceCollection && updatedSourceCollection.variableIds.length === 0) {
              updatedSourceCollection.remove();
            }
          } catch (deleteError) {
            errors.push(`Failed to delete collection "${sourceCollection.name}": ${deleteError.message}`);
          }
        }
      }
    }

    // Send success message back to UI
    figma.ui.postMessage({
      type: 'merge-complete',
      movedCount: movedCount,
      errors: errors,
      cancelled: cancelRequested
    });

    // Reload collections to update the UI with current state
    await loadCollections();

  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Merge failed: ' + error.message
    });
  } finally {
    operationRunning = false;
  }
}

// Helper function to check if a value is a variable alias
function isVariableAlias(value) {
  return value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS' && value.id;
}

// Update backreferences across all collections when variables are moved
async function updateBackreferences(variableIdMap, errors) {
  if (variableIdMap.size === 0) return 0;

  sendProgress('Updating references in other collections…');

  let updatedCount = 0;
  const allCollections = await figma.variables.getLocalVariableCollectionsAsync();

  for (const collection of allCollections) {
    for (const variableId of collection.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(variableId);
      if (!variable) continue;

      for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
        if (isVariableAlias(value)) {
          const newVariable = variableIdMap.get(value.id);
          if (newVariable) {
            try {
              const newAlias = figma.variables.createVariableAlias(newVariable);
              variable.setValueForMode(modeId, newAlias);
              updatedCount++;
            } catch (aliasError) {
              errors.push(`Failed to update backreference in "${variable.name}": ${aliasError.message}`);
            }
          }
        }
      }
    }
  }
  return updatedCount;
}

// Send a progress update to the UI (e.g. to live-update a button label)
function sendProgress(message, extra) {
  figma.ui.postMessage(Object.assign({ type: 'progress', message: message }, extra || {}));
}

// Walk every node in the document and rewire any variable bindings that point
// at variables we're about to remove. Without this, removing the source
// variable leaves design nodes showing "?" where the binding used to be.
// How many nodes to process between yields, on pages heavy enough to need it.
// Small enough that progress/cancel stay responsive; large enough that the
// yield overhead itself doesn't dominate on files with many light pages.
const REBIND_NODES_PER_YIELD = 200;

async function updateDesignNodeBindings(variableIdMap, errors) {
  if (variableIdMap.size === 0) return 0;

  // A stale flag from a previously-cancelled operation must not silently
  // abort this new one.
  cancelRequested = false;

  sendProgress('Loading all pages…', { phase: 'rebind' });
  try {
    await figma.loadAllPagesAsync();
  } catch (loadError) {
    errors.push(`Failed to load all pages: ${loadError.message}`);
    return 0;
  }

  let updatedCount = 0;
  const pages = figma.root.children.filter(n => n.type === 'PAGE');

  for (let p = 0; p < pages.length; p++) {
    if (cancelRequested) {
      errors.push(`Cancelled by user — ${pages.length - p} of ${pages.length} pages were not processed.`);
      break;
    }

    const page = pages[p];
    sendProgress(`Rebinding variables — page ${p + 1}/${pages.length}: "${page.name}"`, {
      phase: 'rebind', current: p, total: pages.length
    });
    // Yield here so the progress line above actually renders before this
    // page's (potentially large) findAll + loop begins.
    await yieldToUI();

    updatedCount += rebindNodeVariables(page, variableIdMap, errors);

    const nodes = page.findAll(() => true);
    for (let i = 0; i < nodes.length; i++) {
      updatedCount += rebindNodeVariables(nodes[i], variableIdMap, errors);

      if (i > 0 && i % REBIND_NODES_PER_YIELD === 0) {
        sendProgress(
          `Rebinding variables — page ${p + 1}/${pages.length}: "${page.name}" (${i}/${nodes.length} nodes)`,
          { phase: 'rebind', current: p, total: pages.length, subCurrent: i, subTotal: nodes.length }
        );
        await yieldToUI();
        if (cancelRequested) {
          errors.push(`Cancelled by user mid-page "${page.name}" (${i}/${nodes.length} nodes done on this page).`);
          break;
        }
      }
    }
    if (cancelRequested) break;
  }

  return updatedCount;
}

function rebindNodeVariables(node, variableIdMap, errors) {
  let count = 0;
  const rebindPaint = (p, f, v) => figma.variables.setBoundVariableForPaint(p, f, v);
  const rebindEffect = (e, f, v) => figma.variables.setBoundVariableForEffect(e, f, v);
  const rebindGrid = (g, f, v) => figma.variables.setBoundVariableForLayoutGrid(g, f, v);

  count += rebindStyleArray(node, 'fills', rebindPaint, variableIdMap, errors);
  count += rebindStyleArray(node, 'strokes', rebindPaint, variableIdMap, errors);
  count += rebindStyleArray(node, 'backgrounds', rebindPaint, variableIdMap, errors);
  count += rebindStyleArray(node, 'effects', rebindEffect, variableIdMap, errors);
  count += rebindStyleArray(node, 'layoutGrids', rebindGrid, variableIdMap, errors);
  count += rebindScalarFields(node, variableIdMap, errors);
  count += rebindTextRangeFills(node, variableIdMap, errors);
  return count;
}

function rebindStyleArray(node, propName, rebuild, variableIdMap, errors) {
  if (!(propName in node)) return 0;
  const items = node[propName];
  // figma.mixed is a Symbol, so Array.isArray filters it out naturally
  if (!Array.isArray(items) || items.length === 0) return 0;

  let newItems = items;
  let changed = false;
  let count = 0;

  for (let i = 0; i < newItems.length; i++) {
    const item = newItems[i];
    if (!item || !item.boundVariables) continue;

    for (const [field, binding] of Object.entries(item.boundVariables)) {
      if (!binding || !binding.id || !variableIdMap.has(binding.id)) continue;
      const newVar = variableIdMap.get(binding.id);
      try {
        const rebuilt = rebuild(newItems[i], field, newVar);
        newItems = newItems.map((it, idx) => idx === i ? rebuilt : it);
        changed = true;
        count++;
      } catch (e) {
        errors.push(`Failed to rebind ${propName}.${field} on "${node.name}": ${e.message}`);
      }
    }
  }

  if (changed) {
    try {
      node[propName] = newItems;
    } catch (e) {
      errors.push(`Failed to apply rebound ${propName} on "${node.name}": ${e.message}`);
    }
  }

  return count;
}

// Fields on node.boundVariables that are arrays or non-rebindable here
const NON_SCALAR_BOUND_FIELDS = new Set([
  'fills', 'strokes', 'effects', 'layoutGrids', 'backgrounds',
  'componentProperties', 'variantProperties', 'textRangeFills'
]);

function rebindScalarFields(node, variableIdMap, errors) {
  if (!node.boundVariables) return 0;

  let count = 0;
  for (const [field, binding] of Object.entries(node.boundVariables)) {
    if (NON_SCALAR_BOUND_FIELDS.has(field)) continue;
    if (!binding || Array.isArray(binding) || !binding.id) continue;
    if (!variableIdMap.has(binding.id)) continue;

    const newVar = variableIdMap.get(binding.id);
    try {
      node.setBoundVariable(field, newVar);
      count++;
    } catch (e) {
      errors.push(`Failed to rebind ${field} on "${node.name}": ${e.message}`);
    }
  }

  return count;
}

function rebindTextRangeFills(node, variableIdMap, errors) {
  if (node.type !== 'TEXT') return 0;
  if (typeof node.getStyledTextSegments !== 'function') return 0;

  let segments;
  try {
    segments = node.getStyledTextSegments(['fills']);
  } catch (e) {
    return 0;
  }

  let count = 0;
  for (const segment of segments) {
    if (!Array.isArray(segment.fills) || segment.fills.length === 0) continue;

    let newFills = segment.fills;
    let segmentChanged = false;

    for (let i = 0; i < newFills.length; i++) {
      const paint = newFills[i];
      if (!paint || !paint.boundVariables) continue;

      for (const [field, binding] of Object.entries(paint.boundVariables)) {
        if (!binding || !binding.id || !variableIdMap.has(binding.id)) continue;
        const newVar = variableIdMap.get(binding.id);
        try {
          const rebuilt = figma.variables.setBoundVariableForPaint(newFills[i], field, newVar);
          newFills = newFills.map((p, idx) => idx === i ? rebuilt : p);
          segmentChanged = true;
          count++;
        } catch (e) {
          errors.push(`Failed to rebind text range fill on "${node.name}": ${e.message}`);
        }
      }
    }

    if (segmentChanged) {
      try {
        node.setRangeFills(segment.start, segment.end, newFills);
      } catch (e) {
        errors.push(`Failed to apply text range fills on "${node.name}": ${e.message}`);
      }
    }
  }

  return count;
}

// Split groups from a collection into a single new collection
async function splitCollection(sourceCollectionId, groupNames, newCollectionName) {
  operationRunning = true;
  try {
    const sourceCollection = await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);
    
    if (!sourceCollection) {
      throw new Error('Source collection not found');
    }

    let movedCount = 0;
    const errors = [];
    
    const sourceModes = sourceCollection.modes;
    
    // Create the new collection
    const newCollection = figma.variables.createVariableCollection(newCollectionName);
    
    // Copy modes from source to new collection
    newCollection.renameMode(newCollection.modes[0].modeId, sourceModes[0].name);
    
    // Add additional modes
    for (let i = 1; i < sourceModes.length; i++) {
      try {
        newCollection.addMode(sourceModes[i].name);
      } catch (modeError) {
        errors.push(`Failed to add mode "${sourceModes[i].name}": ${modeError.message}`);
      }
    }
    
    // Get the new collection's modes for mapping
    const newModes = newCollection.modes;
    
    // Map to track old variable ID -> new variable for alias resolution
    const variableIdMap = new Map();
    const variablesWithAliases = [];
    
    // Get all variable IDs from source collection
    const variableIds = [...sourceCollection.variableIds];
    
    // PHASE 1: Create all variables in the new collection (for all selected groups)
    for (const variableId of variableIds) {
      const sourceVariable = await figma.variables.getVariableByIdAsync(variableId);
      
      if (!sourceVariable) continue;
      
      // Check if this variable belongs to any of the selected groups
      let matchedGroup = null;
      for (const groupName of groupNames) {
        if (sourceVariable.name.startsWith(groupName + '/')) {
          matchedGroup = groupName;
          break;
        }
      }
      
      if (!matchedGroup) continue;
      
      try {
        // Determine the new variable name:
        // - Single group selected: remove prefix (e.g., "neutral/50" -> "50")
        // - Multiple groups selected: keep prefix to avoid duplicates (e.g., "neutral/50" stays "neutral/50")
        let newName = sourceVariable.name;
        if (groupNames.length === 1) {
          newName = sourceVariable.name.substring(matchedGroup.length + 1);
        }
        
        // Create the variable in the new collection
        const newVariable = figma.variables.createVariable(
          newName,
          newCollection,
          sourceVariable.resolvedType
        );
        
        // Store mapping for alias resolution
        variableIdMap.set(sourceVariable.id, newVariable);
        
        // Track alias info
        const aliasInfo = {
          newVariable: newVariable,
          sourceVariable: sourceVariable,
          targetModesToFill: []
        };
        
        // Copy values for each mode
        for (let i = 0; i < sourceModes.length && i < newModes.length; i++) {
          const sourceMode = sourceModes[i];
          const newMode = newModes[i];
          
          const sourceValue = sourceVariable.valuesByMode[sourceMode.modeId];
          
          if (sourceValue === undefined) continue;
          
          if (isVariableAlias(sourceValue)) {
            aliasInfo.targetModesToFill.push({
              targetModeId: newMode.modeId,
              sourceValue: sourceValue
            });
          } else {
            newVariable.setValueForMode(newMode.modeId, sourceValue);
          }
        }
        
        if (aliasInfo.targetModesToFill.length > 0) {
          variablesWithAliases.push(aliasInfo);
        }
        
        // Copy other properties
        if (sourceVariable.description) {
          newVariable.description = sourceVariable.description;
        }
        
        if (sourceVariable.hiddenFromPublishing !== undefined) {
          newVariable.hiddenFromPublishing = sourceVariable.hiddenFromPublishing;
        }
        
        if (sourceVariable.scopes && sourceVariable.scopes.length > 0) {
          newVariable.scopes = sourceVariable.scopes;
        }
        
        if (sourceVariable.codeSyntax) {
          for (const [platform, syntax] of Object.entries(sourceVariable.codeSyntax)) {
            if (syntax) {
              newVariable.setVariableCodeSyntax(platform, syntax);
            }
          }
        }
        
        movedCount++;
        
      } catch (varError) {
        errors.push(`Failed to create variable "${sourceVariable.name}": ${varError.message}`);
      }
    }
    
    // PHASE 2: Resolve aliases
    for (const aliasInfo of variablesWithAliases) {
      const { newVariable, sourceVariable, targetModesToFill } = aliasInfo;
      
      for (const { targetModeId, sourceValue } of targetModesToFill) {
        if (isVariableAlias(sourceValue)) {
          try {
            const referencedVariableId = sourceValue.id;
            const newReferencedVariable = variableIdMap.get(referencedVariableId);
            
            if (newReferencedVariable) {
              // The referenced variable was also moved to the new collection
              const newAlias = figma.variables.createVariableAlias(newReferencedVariable);
              newVariable.setValueForMode(targetModeId, newAlias);
            } else {
              // The referenced variable stays in the original collection, keep the reference
              newVariable.setValueForMode(targetModeId, sourceValue);
            }
          } catch (aliasError) {
            errors.push(`Failed to resolve alias in "${sourceVariable.name}": ${aliasError.message}`);
          }
        }
      }
    }

    // PHASE 2.5: Update backreferences in other collections
    await updateBackreferences(variableIdMap, errors);

    // PHASE 2.6: Rewire design-node bindings so nodes keep their bindings
    await updateDesignNodeBindings(variableIdMap, errors);

    // PHASE 3: Remove the original variables from the source collection.
    // Skipped if the rebind pass above was cancelled partway — see the same
    // guard in mergeCollections for why.
    if (cancelRequested) {
      errors.push('Operation cancelled — original variables were left in place (new variables in the target collection were already created and are safe to keep or delete manually).');
    } else {
      sendProgress('Removing old variables…');
      for (const variableId of variableIds) {
        const sourceVariable = await figma.variables.getVariableByIdAsync(variableId);

        if (!sourceVariable) continue;

        // Check if this variable belongs to any of the selected groups
        let belongsToSelectedGroup = false;
        for (const groupName of groupNames) {
          if (sourceVariable.name.startsWith(groupName + '/')) {
            belongsToSelectedGroup = true;
            break;
          }
        }

        if (!belongsToSelectedGroup) continue;

        try {
          sourceVariable.remove();
        } catch (removeError) {
          errors.push(`Failed to remove original variable: ${removeError.message}`);
        }
      }
    }

    // Send success message
    figma.ui.postMessage({
      type: 'split-complete',
      movedCount: movedCount,
      collectionName: newCollectionName,
      errors: errors,
      cancelled: cancelRequested
    });
    
    // Reload collections
    await loadCollections();
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Split failed: ' + error.message
    });
  } finally {
    operationRunning = false;
  }
}

// Move a group from one collection to another (existing or new)
async function moveGroup(sourceCollectionId, targetCollectionId, newCollectionName, groupPath, isWholeCollectionGroup) {
  operationRunning = true;
  try {
    const sourceCollection = await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);

    if (!sourceCollection) {
      throw new Error('Source collection not found');
    }

    let targetCollection;

    // Create new collection if requested, otherwise get existing one
    if (newCollectionName) {
      targetCollection = figma.variables.createVariableCollection(newCollectionName);

      // Copy modes from source collection to new collection
      const sourceModes = sourceCollection.modes;
      targetCollection.renameMode(targetCollection.modes[0].modeId, sourceModes[0].name);

      // Add additional modes
      for (let i = 1; i < sourceModes.length; i++) {
        try {
          targetCollection.addMode(sourceModes[i].name);
        } catch (modeError) {
          // Mode already exists or error adding, continue
        }
      }
    } else {
      targetCollection = await figma.variables.getVariableCollectionByIdAsync(targetCollectionId);

      if (!targetCollection) {
        throw new Error('Target collection not found');
      }
    }

    let movedCount = 0;
    const errors = [];

    const sourceModes = sourceCollection.modes;
    const targetModes = targetCollection.modes;

    // Map to track old variable ID -> new variable for alias resolution
    const variableIdMap = new Map();
    const variablesWithAliases = [];

    // Get all variable IDs from source collection
    const variableIds = [...sourceCollection.variableIds];

    // Prefix to match (groupPath + '/'). Unused when isWholeCollectionGroup —
    // that mode (for collections with no "/" grouping at all, e.g. flatly
    // named "chart 1".."chart 5") matches every variable in the source
    // collection instead, and prefixes each with the collection's own name
    // on the way in so they land as one recognizable group in the target.
    const groupPrefix = groupPath + '/';

    function belongsToSelectedGroup(sourceVariable) {
      return isWholeCollectionGroup || sourceVariable.name.startsWith(groupPrefix);
    }

    function targetVariableName(sourceVariable) {
      return isWholeCollectionGroup
        ? sourceCollection.name + '/' + sourceVariable.name
        : sourceVariable.name;
    }

    // PHASE 1: Create all variables in the target collection
    for (const variableId of variableIds) {
      const sourceVariable = await figma.variables.getVariableByIdAsync(variableId);

      if (!sourceVariable) continue;

      // Check if this variable belongs to the selected group
      if (!belongsToSelectedGroup(sourceVariable)) continue;

      try {
        // Create the variable in the target collection (prefixed with the
        // source collection's own name in whole-collection mode, unchanged
        // otherwise)
        const newVariable = figma.variables.createVariable(
          targetVariableName(sourceVariable),
          targetCollection,
          sourceVariable.resolvedType
        );

        // Store mapping for alias resolution
        variableIdMap.set(sourceVariable.id, newVariable);

        // Track alias info
        const aliasInfo = {
          newVariable: newVariable,
          sourceVariable: sourceVariable,
          targetModesToFill: []
        };

        // Copy values for each mode
        // Handle mode count mismatch by using first source mode as fallback
        const firstModeValue = sourceVariable.valuesByMode[sourceModes[0].modeId];

        for (let i = 0; i < targetModes.length; i++) {
          const targetMode = targetModes[i];
          const sourceMode = sourceModes[i]; // May be undefined if source has fewer modes

          let sourceValue;

          if (sourceMode) {
            // Source has this mode, use its value
            sourceValue = sourceVariable.valuesByMode[sourceMode.modeId];
          } else if (firstModeValue !== undefined) {
            // Source doesn't have this mode, fill from first mode
            sourceValue = firstModeValue;
          } else {
            // No value available
            continue;
          }

          if (sourceValue === undefined) continue;

          if (isVariableAlias(sourceValue)) {
            aliasInfo.targetModesToFill.push({
              targetModeId: targetMode.modeId,
              sourceValue: sourceValue
            });
          } else {
            newVariable.setValueForMode(targetMode.modeId, sourceValue);
          }
        }

        if (aliasInfo.targetModesToFill.length > 0) {
          variablesWithAliases.push(aliasInfo);
        }

        // Copy other properties
        if (sourceVariable.description) {
          newVariable.description = sourceVariable.description;
        }

        if (sourceVariable.hiddenFromPublishing !== undefined) {
          newVariable.hiddenFromPublishing = sourceVariable.hiddenFromPublishing;
        }

        if (sourceVariable.scopes && sourceVariable.scopes.length > 0) {
          newVariable.scopes = sourceVariable.scopes;
        }

        if (sourceVariable.codeSyntax) {
          for (const [platform, syntax] of Object.entries(sourceVariable.codeSyntax)) {
            if (syntax) {
              newVariable.setVariableCodeSyntax(platform, syntax);
            }
          }
        }

        movedCount++;

      } catch (varError) {
        errors.push(`Failed to create variable "${sourceVariable.name}": ${varError.message}`);
      }
    }

    // PHASE 2: Resolve aliases
    for (const aliasInfo of variablesWithAliases) {
      const { newVariable, sourceVariable, targetModesToFill } = aliasInfo;

      for (const { targetModeId, sourceValue } of targetModesToFill) {
        if (isVariableAlias(sourceValue)) {
          try {
            const referencedVariableId = sourceValue.id;
            const newReferencedVariable = variableIdMap.get(referencedVariableId);

            if (newReferencedVariable) {
              // The referenced variable was also moved to the target collection
              const newAlias = figma.variables.createVariableAlias(newReferencedVariable);
              newVariable.setValueForMode(targetModeId, newAlias);
            } else {
              // The referenced variable stays in another collection, keep the reference
              newVariable.setValueForMode(targetModeId, sourceValue);
            }
          } catch (aliasError) {
            errors.push(`Failed to resolve alias in "${sourceVariable.name}": ${aliasError.message}`);
          }
        }
      }
    }

    // PHASE 2.5: Update backreferences in other collections
    await updateBackreferences(variableIdMap, errors);

    // PHASE 2.6: Rewire design-node bindings so nodes keep their bindings
    await updateDesignNodeBindings(variableIdMap, errors);

    // PHASE 3: Remove the original variables from the source collection.
    // Skipped if the rebind pass above was cancelled partway — see the same
    // guard in mergeCollections for why.
    if (cancelRequested) {
      errors.push('Operation cancelled — original variables were left in place (new variables in the target collection were already created and are safe to keep or delete manually).');
    } else {
      sendProgress('Removing old variables…');
      for (const variableId of variableIds) {
        const sourceVariable = await figma.variables.getVariableByIdAsync(variableId);

        if (!sourceVariable) continue;

        // Check if this variable belongs to the selected group
        if (!belongsToSelectedGroup(sourceVariable)) continue;

        try {
          sourceVariable.remove();
        } catch (removeError) {
          errors.push(`Failed to remove original variable: ${removeError.message}`);
        }
      }

      // Whole-collection mode moved every variable out, so the source
      // collection is now empty and no longer serves any purpose — remove it
      // too, matching the semantic of "relocate this entire collection".
      if (isWholeCollectionGroup) {
        try {
          const updatedSourceCollection = await figma.variables.getVariableCollectionByIdAsync(sourceCollectionId);
          if (updatedSourceCollection && updatedSourceCollection.variableIds.length === 0) {
            updatedSourceCollection.remove();
          }
        } catch (deleteError) {
          errors.push(`Failed to delete now-empty source collection "${sourceCollection.name}": ${deleteError.message}`);
        }
      }
    }

    // Send success message
    figma.ui.postMessage({
      type: 'move-complete',
      movedCount: movedCount,
      newCollectionName: newCollectionName,
      errors: errors,
      cancelled: cancelRequested
    });

    // Reload collections
    await loadCollections();

  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Move failed: ' + error.message
    });
  } finally {
    operationRunning = false;
  }
}

// Handle messages from the UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'load-collections':
      await loadCollections();
      break;

    case 'merge-collections':
      await mergeCollections(
        msg.targetCollectionId,
        msg.sourceCollectionIds,
        msg.deleteSourceCollections,
        msg.groupByCollection,
        msg.fillMissingModes,
        msg.newTargetName,
        msg.groupTargetVariables
      );
      break;

    case 'split-collection':
      await splitCollection(
        msg.sourceCollectionId,
        msg.groupNames,
        msg.newCollectionName
      );
      break;

    case 'move-group':
      await moveGroup(
        msg.sourceCollectionId,
        msg.targetCollectionId,
        msg.newCollectionName,
        msg.groupPath,
        msg.isWholeCollectionGroup
      );
      break;

    case 'cancel':
      if (operationRunning) {
        // Cooperative: just flip a flag that the running operation's yield
        // points check — it will stop at the next safe checkpoint (never
        // mid-mutation) and skip the destructive "remove old variables"
        // phase, rather than being force-killed via figma.closePlugin().
        cancelRequested = true;
      } else {
        // No operation running — this Cancel click means "close the dialog".
        figma.closePlugin();
      }
      break;
  }
};

// Initial load when plugin starts
loadCollections();
