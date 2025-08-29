
<!-- code.js -->
// Show the plugin UI
figma.showUI(__html__, { width: 240, height: 480 });

// Handle messages from the UI
figma.ui.onmessage = msg => {
  if (msg.type === 'rename-layer') {
    handleRenameLayer(msg.name);
  } else if (msg.type === 'set-spacing') {
    handleSetSpacing(msg.spacing);
  }
};

function handleRenameLayer(newName) {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select a layer to rename',
      success: false
    });
    return;
  }

  let renamedCount = 0;

  selection.forEach(node => {
    node.name = newName;
    renamedCount++;
  });

  const layerText = renamedCount === 1 ? 'layer' : 'layers';
  figma.ui.postMessage({
    type: 'status',
    message: `Renamed ${renamedCount} ${layerText} to "${newName}"`,
    success: true
  });
}

function handleSetSpacing(spacing) {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select a layer to set spacing',
      success: false
    });
    return;
  }

  let updatedCount = 0;

  selection.forEach(node => {
    // Check if the node supports auto layout (frames, components, instances)
    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'COMPONENT_SET') {
      // Check if auto layout is enabled
      if (node.layoutMode !== 'NONE') {
        // Set padding for auto layout nodes
        node.paddingTop = spacing;
        node.paddingRight = spacing;
        node.paddingBottom = spacing;
        node.paddingLeft = spacing;

        // Set item spacing (gap between children)
        if (spacing === 64) {
          node.itemSpacing = 32;
        } else if (spacing === 0) {
          node.itemSpacing = 0;
        }

        updatedCount++;
      } else {
        // If auto layout is not enabled, we can't set spacing directly
        // Could optionally enable auto layout here, but that might change the design significantly
        figma.ui.postMessage({
          type: 'status',
          message: `"${node.name}" doesn't have auto layout enabled. Enable auto layout to set spacing.`,
          success: false
        });
        return;
      }
    } else {
      figma.ui.postMessage({
        type: 'status',
        message: `"${node.name}" doesn't support spacing. Select frames, components, or instances with auto layout.`,
        success: false
      });
      return;
    }
  });

  if (updatedCount > 0) {
    const layerText = updatedCount === 1 ? 'layer' : 'layers';
    let message = `Set ${spacing}px spacing on ${updatedCount} ${layerText}`;

    // Add gap information for both spacing options
    if (spacing === 64) {
      message += ' and 32px gap';
    } else if (spacing === 0) {
      message += ' and 0px gap';
    }

    figma.ui.postMessage({
      type: 'status',
      message: message,
      success: true
    });
  }
}