// Show the plugin UI with Figma's theme colors enabled
figma.showUI(__html__, { width: 480, height: 600, themeColors: true });

// Store collections and variables data
let collectionsData = [];

// Initialize plugin by loading all variable collections
async function loadCollections() {
  try {
    // Use the async method to get all local variable collections
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
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
      
      for (const variableId of existingVariableIds) {
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (variable) {
          try {
            // Add the original collection name as a group prefix
            variable.name = originalTargetName + '/' + variable.name;
          } catch (renameError) {
            errors.push(`Failed to rename existing variable "${variable.name}": ${renameError.message}`);
          }
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
      
      for (const variableId of variableIds) {
        const sourceVariable = await figma.variables.getVariableByIdAsync(variableId);
        
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

    // PHASE 3: Remove source variables and optionally delete collections
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

    // Send success message back to UI
    figma.ui.postMessage({
      type: 'merge-complete',
      movedCount: movedCount,
      errors: errors
    });

    // Reload collections to update the UI with current state
    await loadCollections();

  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Merge failed: ' + error.message
    });
  }
}

// Helper function to check if a value is a variable alias
function isVariableAlias(value) {
  return value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS' && value.id;
}

// Split groups from a collection into a single new collection
async function splitCollection(sourceCollectionId, groupNames, newCollectionName) {
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
    
    // PHASE 3: Remove the original variables from the source collection
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
    
    // Send success message
    figma.ui.postMessage({
      type: 'split-complete',
      movedCount: movedCount,
      collectionName: newCollectionName,
      errors: errors
    });
    
    // Reload collections
    await loadCollections();
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Split failed: ' + error.message
    });
  }
}

// Move a group from one collection to another (existing or new)
async function moveGroup(sourceCollectionId, targetCollectionId, newCollectionName, groupPath) {
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

    // Prefix to match (groupPath + '/')
    const groupPrefix = groupPath + '/';

    // PHASE 1: Create all variables in the target collection
    for (const variableId of variableIds) {
      const sourceVariable = await figma.variables.getVariableByIdAsync(variableId);

      if (!sourceVariable) continue;

      // Check if this variable belongs to the selected group
      if (!sourceVariable.name.startsWith(groupPrefix)) continue;

      try {
        // Create the variable in the target collection with the same name
        const newVariable = figma.variables.createVariable(
          sourceVariable.name,
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

    // PHASE 3: Remove the original variables from the source collection
    for (const variableId of variableIds) {
      const sourceVariable = await figma.variables.getVariableByIdAsync(variableId);

      if (!sourceVariable) continue;

      // Check if this variable belongs to the selected group
      if (!sourceVariable.name.startsWith(groupPrefix)) continue;

      try {
        sourceVariable.remove();
      } catch (removeError) {
        errors.push(`Failed to remove original variable: ${removeError.message}`);
      }
    }

    // Send success message
    figma.ui.postMessage({
      type: 'move-complete',
      movedCount: movedCount,
      newCollectionName: newCollectionName,
      errors: errors
    });

    // Reload collections
    await loadCollections();

  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Move failed: ' + error.message
    });
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
        msg.groupPath
      );
      break;

    case 'cancel':
      figma.closePlugin();
      break;
  }
};

// Initial load when plugin starts
loadCollections();
