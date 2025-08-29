
<!-- code.js -->
// Show the plugin UI
figma.showUI(__html__, { width: 280, height: 480 });

// Handle messages from the UI
figma.ui.onmessage = msg => {
  if (msg.type === 'rename-layer') {
    handleRenameLayer(msg.name);
  } else if (msg.type === 'set-spacing') {
    handleSetSpacing(msg.spacing);
  } else if (msg.type === 'set-frame-spacing') {
    handleSetFrameSpacing(msg.direction);
  } else if (msg.type === 'deprecate-component') {
    handleDeprecateComponent();
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

function handleSetFrameSpacing(direction) {
  const selection = figma.currentPage.selection;

  if (selection.length < 2) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select at least 2 frames to set spacing between them',
      success: false
    });
    return;
  }

  const topLevelFrames = selection.filter(node => 
    (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') && 
    node.parent === figma.currentPage
  );

  if (topLevelFrames.length < 2) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select at least 2 top-level frames',
      success: false
    });
    return;
  }

  if (direction === 'vertical') {
    topLevelFrames.sort((a, b) => a.y - b.y);
    
    for (let i = 1; i < topLevelFrames.length; i++) {
      const prevFrame = topLevelFrames[i - 1];
      const currentFrame = topLevelFrames[i];
      currentFrame.y = prevFrame.y + prevFrame.height + 256;
    }
  } else if (direction === 'horizontal') {
    topLevelFrames.sort((a, b) => a.x - b.x);
    
    for (let i = 1; i < topLevelFrames.length; i++) {
      const prevFrame = topLevelFrames[i - 1];
      const currentFrame = topLevelFrames[i];
      currentFrame.x = prevFrame.x + prevFrame.width + 256;
    }
  }

  const frameText = topLevelFrames.length === 1 ? 'frame' : 'frames';
  figma.ui.postMessage({
    type: 'status',
    message: `Set 256px ${direction} spacing between ${topLevelFrames.length} ${frameText}`,
    success: true
  });
}

function handleDeprecateComponent() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select a component to deprecate',
      success: false
    });
    return;
  }

  let deprecatedCount = 0;

  selection.forEach(node => {
    if (!node.name.startsWith('🛑DEPRECATED - ')) {
      node.name = `🛑DEPRECATED - ${node.name}`;
      deprecatedCount++;
    }
  });

  if (deprecatedCount === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Selected layers are already deprecated',
      success: false
    });
    return;
  }

  const layerText = deprecatedCount === 1 ? 'component' : 'components';
  figma.ui.postMessage({
    type: 'status',
    message: `Deprecated ${deprecatedCount} ${layerText}`,
    success: true
  });
}