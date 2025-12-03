// Mode Switcher Plugin
// Scans for modes with the same name across variable collections
// and allows applying them all at once

figma.showUI(__html__, { width: 416, height: 520 });

// Scan all variable collections and find modes that share names
async function scanForSharedModes() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  
  // Map: modeName -> array of { collectionId, collectionName, modeId }
  const modeNameMap = new Map();
  
  for (const collection of collections) {
    for (const mode of collection.modes) {
      const modeName = mode.name;
      
      if (!modeNameMap.has(modeName)) {
        modeNameMap.set(modeName, []);
      }
      
      modeNameMap.get(modeName).push({
        collectionId: collection.id,
        collectionName: collection.name,
        modeId: mode.modeId
      });
    }
  }
  
  // Filter to only modes that appear in multiple collections
  const sharedModes = [];
  
  for (const [modeName, occurrences] of modeNameMap.entries()) {
    if (occurrences.length > 1) {
      sharedModes.push({
        name: modeName,
        count: occurrences.length,
        modes: occurrences
      });
    }
  }
  
  // Sort alphabetically
  sharedModes.sort((a, b) => a.name.localeCompare(b.name));
  
  return sharedModes;
}

// Apply all modes for a given shared mode name to selected nodes or current page
async function applySharedMode(sharedMode, applyTo) {
  let targetNodes = [];

  if (applyTo === 'selection') {
    targetNodes = figma.currentPage.selection.filter(node =>
      'explicitVariableModes' in node
    );

    if (targetNodes.length === 0) {
      figma.notify('Please select at least one frame, component, or section', { error: true });
      return { success: false, message: 'No valid selection' };
    }
  } else if (applyTo === 'page') {
    // Apply to the page itself
    targetNodes = [figma.currentPage];
  }

  let appliedCount = 0;
  let errors = [];
  let loadedFonts = new Set();

  // Helper to load fonts for typography variables
  async function loadFontsForCollection(collection, modeId) {
    // Fetch all variables asynchronously
    const variables = await Promise.all(
      collection.variableIds.map(id => figma.variables.getVariableByIdAsync(id))
    );

    for (const variable of variables) {
      if (!variable) continue;

      // Check if this variable has a value for the mode we're applying
      const value = variable.valuesByMode[modeId];
      if (!value || typeof value !== 'object') continue;

      // Check if it's a typography value (has fontFamily and fontStyle)
      if (value.fontFamily && value.fontStyle) {
        const fontKey = `${value.fontFamily}:${value.fontStyle}`;

        if (!loadedFonts.has(fontKey)) {
          try {
            await figma.loadFontAsync({ family: value.fontFamily, style: value.fontStyle });
            loadedFonts.add(fontKey);
          } catch (e) {
            const fontError = `Font not available: ${value.fontFamily} ${value.fontStyle}`;
            if (!errors.includes(fontError)) {
              errors.push(fontError);
            }
            console.log(`Could not load font ${value.fontFamily} ${value.fontStyle}: ${e.message}`);
          }
        }
      }
    }
  }

  for (const node of targetNodes) {
    for (const modeInfo of sharedMode.modes) {
      try {
        // Fetch the actual collection node instead of using just the ID
        const collection = await figma.variables.getVariableCollectionByIdAsync(modeInfo.collectionId);

        // Load fonts for typography collections before applying
        await loadFontsForCollection(collection, modeInfo.modeId);

        node.setExplicitVariableModeForCollection(collection, modeInfo.modeId);
        appliedCount++;
      } catch (e) {
        // Track errors to report back to user
        const errorMsg = `${modeInfo.collectionName}: ${e.message}`;
        if (!errors.includes(errorMsg)) {
          errors.push(errorMsg);
        }
        console.log(`Could not apply mode to node: ${errorMsg}`);
      }
    }
  }

  let targetLabel;
  if (applyTo === 'page') {
    targetLabel = 'page';
  } else {
    targetLabel = targetNodes.length === 1 ? 'node' : 'nodes';
  }

  if (errors.length > 0) {
    figma.notify(`Applied "${sharedMode.name}" to ${applyTo === 'page' ? 'page' : targetNodes.length + ' ' + targetLabel}. Errors: ${errors.join('; ')}`, { error: true, timeout: 5000 });
  } else {
    figma.notify(`Applied "${sharedMode.name}" (${sharedMode.count} collections) to ${applyTo === 'page' ? 'page' : targetNodes.length + ' ' + targetLabel}`);
  }

  return {
    success: errors.length === 0,
    message: `Applied to ${applyTo === 'page' ? 'page' : targetNodes.length + ' ' + targetLabel}`,
    nodesAffected: targetNodes.length,
    errors: errors
  };
}

// Clear all variable mode overrides
async function clearModes(clearFrom) {
  let targetNodes = [];

  if (clearFrom === 'selection') {
    targetNodes = figma.currentPage.selection.filter(node =>
      'explicitVariableModes' in node
    );

    if (targetNodes.length === 0) {
      figma.notify('Please select at least one frame, component, or section', { error: true });
      return { success: false, message: 'No valid selection' };
    }
  } else if (clearFrom === 'page') {
    targetNodes = [figma.currentPage];
  }

  let clearedCount = 0;
  const collections = await figma.variables.getLocalVariableCollectionsAsync();

  for (const node of targetNodes) {
    // Check which collections actually have explicit modes set
    const explicitModes = node.explicitVariableModes;
    console.log(`Node type: ${node.type}, Name: ${node.name}`);
    console.log(`Node has explicit modes for ${Object.keys(explicitModes).length} collections:`, explicitModes);
    console.log(`Total collections in file:`, collections.length);

    for (const collection of collections) {
      console.log(`Checking collection: ${collection.name} (ID: ${collection.id})`);
      console.log(`  Has explicit mode: ${explicitModes[collection.id] !== undefined}`);

      // Only try to remove if this collection has an explicit mode set
      if (explicitModes[collection.id] !== undefined) {
        try {
          node.clearExplicitVariableModeForCollection(collection);
          clearedCount++;
          console.log(`✓ Cleared mode for collection: ${collection.name}`);
        } catch (e) {
          console.log(`✗ Could not clear mode for ${collection.name}: ${e.message}`);
        }
      } else {
        console.log(`  Skipping ${collection.name} - no explicit mode set`);
      }
    }
  }

  const targetLabel = clearFrom === 'page' ? 'page' : (targetNodes.length === 1 ? 'node' : 'nodes');

  if (clearedCount > 0) {
    figma.notify(`Cleared ${clearedCount} mode override${clearedCount !== 1 ? 's' : ''} from ${clearFrom === 'page' ? 'page' : targetNodes.length + ' ' + targetLabel}`);
  } else {
    figma.notify(`No mode overrides found to clear`, { error: true });
  }

  return {
    success: clearedCount > 0,
    message: `Cleared ${clearedCount} mode${clearedCount !== 1 ? 's' : ''}`,
    modesCleared: clearedCount
  };
}

// Get current selection info for UI
function getSelectionInfo() {
  const selection = figma.currentPage.selection;
  const validNodes = selection.filter(node => 'explicitVariableModes' in node);

  return {
    totalSelected: selection.length,
    validNodes: validNodes.length
  };
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'scan') {
    const sharedModes = await scanForSharedModes();
    const selectionInfo = getSelectionInfo();
    
    figma.ui.postMessage({
      type: 'scan-result',
      sharedModes: sharedModes,
      selectionInfo: selectionInfo
    });
  }
  
  if (msg.type === 'apply-mode') {
    const result = await applySharedMode(msg.sharedMode, msg.applyTo);

    figma.ui.postMessage({
      type: 'apply-result',
      result: result
    });
  }

  if (msg.type === 'clear-modes') {
    const result = await clearModes(msg.clearFrom);

    figma.ui.postMessage({
      type: 'clear-result',
      result: result
    });
  }

  if (msg.type === 'refresh-selection') {
    const selectionInfo = getSelectionInfo();

    figma.ui.postMessage({
      type: 'selection-info',
      selectionInfo: selectionInfo
    });
  }
  
  if (msg.type === 'close') {
    figma.closePlugin();
  }
};

// Listen for selection changes
figma.on('selectionchange', () => {
  const selectionInfo = getSelectionInfo();
  
  figma.ui.postMessage({
    type: 'selection-info',
    selectionInfo: selectionInfo
  });
});

// Initial scan on plugin load
(async () => {
  const initialModes = await scanForSharedModes();
  const initialSelection = getSelectionInfo();

  figma.ui.postMessage({
    type: 'scan-result',
    sharedModes: initialModes,
    selectionInfo: initialSelection
  });
})();
