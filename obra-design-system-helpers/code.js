
<!-- code.js -->
// Handle direct commands
if (figma.command === 'post-propstar-treatment') {
  handlePostPropstarTreatment(true);
  figma.closePlugin();
} else if (figma.command === 'prop-star-cleanup') {
  handlePropStarCleanup(true);
  figma.closePlugin();
} else if (figma.command === 'frame-spacing-vertical') {
  handleSetFrameSpacing('vertical', true);
  figma.closePlugin();
} else if (figma.command === 'show-ui') {
  // Show the plugin UI
  figma.showUI(__html__, { width: 280, height: 480 });
} else {
  // Default: show UI if no specific command
  figma.showUI(__html__, { width: 280, height: 480 });
}

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
  } else if (msg.type === 'visual-deprecate-component') {
    handleVisualDeprecateComponent();
  } else if (msg.type === 'wrap-in-section') {
    handleWrapInSection();
  } else if (msg.type === 'mark-stop-frame') {
    handleMarkStopFrame();
  } else if (msg.type === 'post-propstar-treatment') {
    handlePostPropstarTreatment();
  } else if (msg.type === 'prop-star-cleanup') {
    handlePropStarCleanup();
  } else if (msg.type === 'set-32px-inner-spacing') {
    handleSet32pxInnerSpacing();
  } else if (msg.type === 'reset-component-set-style') {
    handleResetComponentSetStyle();
  } else if (msg.type === 'detect-components') {
    handleDetectComponents();
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

function handleSetFrameSpacing(direction, isDirectCommand = false) {
  const selection = figma.currentPage.selection;

  if (selection.length < 2) {
    if (!isDirectCommand) {
      figma.ui.postMessage({
        type: 'status',
        message: 'Please select at least 2 frames to set spacing between them',
        success: false
      });
    } else {
      figma.notify('Please select at least 2 frames to set spacing between them');
    }
    return;
  }

  const topLevelFrames = selection.filter(node => 
    (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') && 
    node.parent === figma.currentPage
  );

  if (topLevelFrames.length < 2) {
    if (!isDirectCommand) {
      figma.ui.postMessage({
        type: 'status',
        message: 'Please select at least 2 top-level frames',
        success: false
      });
    } else {
      figma.notify('Please select at least 2 top-level frames');
    }
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
  if (!isDirectCommand) {
    figma.ui.postMessage({
      type: 'status',
      message: `Set 256px ${direction} spacing between ${topLevelFrames.length} ${frameText}`,
      success: true
    });
  } else {
    figma.notify(`Set 256px ${direction} spacing between ${topLevelFrames.length} ${frameText}`);
  }
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

function handleVisualDeprecateComponent() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select a component or component set to visually deprecate',
      success: false
    });
    return;
  }

  let processedCount = 0;
  const processedComponents = new Set();

  selection.forEach(node => {
    if (node.type === 'COMPONENT_SET') {
      // Handle component set - add overlay to all variants
      node.children.forEach(variant => {
        if (variant.type === 'COMPONENT' && !processedComponents.has(variant.id)) {
          addDeprecationOverlay(variant);
          processedComponents.add(variant.id);
          processedCount++;
        }
      });
    } else if (node.type === 'COMPONENT' && !processedComponents.has(node.id)) {
      // Handle individual component
      addDeprecationOverlay(node);
      processedComponents.add(node.id);
      processedCount++;
    }
  });

  if (processedCount === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select components or component sets',
      success: false
    });
    return;
  }

  const componentText = processedCount === 1 ? 'component' : 'components';
  figma.ui.postMessage({
    type: 'status',
    message: `Added visual deprecation overlay to ${processedCount} ${componentText}`,
    success: true
  });
}

function addDeprecationOverlay(component) {
  // Check if overlay already exists
  const existingOverlay = component.children.find(child => child.name === 'DEPRECATED_OVERLAY');
  if (existingOverlay) {
    return;
  }

  // Create red rectangle overlay
  const overlay = figma.createRectangle();
  overlay.name = 'DEPRECATED_OVERLAY';
  
  // Set red fill with 20% opacity
  overlay.fills = [{
    type: 'SOLID',
    color: { r: 1, g: 0, b: 0 },
    opacity: 0.2
  }];
  
  // Remove stroke
  overlay.strokes = [];
  
  // Add to component first
  component.appendChild(overlay);
  
  // Check if component has auto layout
  if (component.layoutMode !== 'NONE') {
    // Component has auto layout - use absolute positioning
    overlay.layoutPositioning = 'ABSOLUTE';
    
    // Set constraints to fill the component
    overlay.constraints = {
      horizontal: 'STRETCH',
      vertical: 'STRETCH'
    };
  } else {
    // Component doesn't have auto layout - use regular constraints
    overlay.constraints = {
      horizontal: 'STRETCH',
      vertical: 'STRETCH'
    };
  }
  
  // Size to fill component
  overlay.resize(component.width, component.height);
  overlay.x = 0;
  overlay.y = 0;
  
  // Move to top layer
  component.insertChild(component.children.length - 1, overlay);
}

function handleWrapInSection() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select a component to wrap in section',
      success: false
    });
    return;
  }

  let wrappedCount = 0;

  selection.forEach(node => {
    // Store original position and parent info
    const originalX = node.x;
    const originalY = node.y;
    const originalParent = node.parent;
    const originalIndex = originalParent.children.indexOf(node);
    
    // Create section frame
    const sectionFrame = figma.createFrame();
    sectionFrame.name = 'Section';
    
    // Set up auto layout
    sectionFrame.layoutMode = 'VERTICAL';
    sectionFrame.primaryAxisSizingMode = 'AUTO';
    sectionFrame.counterAxisSizingMode = 'AUTO';
    
    // Set section spacing (64px padding, 32px gap)
    sectionFrame.paddingTop = 64;
    sectionFrame.paddingRight = 64;
    sectionFrame.paddingBottom = 64;
    sectionFrame.paddingLeft = 64;
    sectionFrame.itemSpacing = 32;
    
    // Set fills to transparent
    sectionFrame.fills = [];
    
    // Position section frame at the original node's position
    sectionFrame.x = originalX;
    sectionFrame.y = originalY;
    
    // Create heading text
    const headingText = figma.createText();
    headingText.name = node.name;
    
    // Load Inter font and set text properties
    figma.loadFontAsync({ family: "Inter", style: "Medium" }).then(() => {
      headingText.fontName = { family: "Inter", style: "Medium" };
      headingText.fontSize = 16;
      headingText.characters = node.name;
      headingText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    }).catch(() => {
      // Fallback if Inter is not available
      headingText.fontSize = 16;
      headingText.characters = node.name;
      headingText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    });
    
    // Add section frame to original parent at original position
    originalParent.insertChild(originalIndex, sectionFrame);
    
    // Add heading text to section frame
    sectionFrame.appendChild(headingText);
    
    // Move original node to section frame (this removes it from original parent)
    sectionFrame.appendChild(node);
    
    wrappedCount++;
  });

  const componentText = wrappedCount === 1 ? 'component' : 'components';
  figma.ui.postMessage({
    type: 'status',
    message: `Wrapped ${wrappedCount} ${componentText} in section`,
    success: true
  });
}

function handleMarkStopFrame() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select a frame to mark with stop emoji',
      success: false
    });
    return;
  }

  let markedCount = 0;

  selection.forEach(node => {
    if (!node.name.startsWith('🛑 ')) {
      node.name = `🛑 ${node.name}`;
      markedCount++;
    }
  });

  if (markedCount === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Selected frames already have stop emoji',
      success: false
    });
    return;
  }

  const frameText = markedCount === 1 ? 'frame' : 'frames';
  figma.ui.postMessage({
    type: 'status',
    message: `Marked ${markedCount} ${frameText} with stop emoji`,
    success: true
  });
}

function handlePostPropstarTreatment(isDirectCommand = false) {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    if (!isDirectCommand) {
      figma.ui.postMessage({
        type: 'status',
        message: 'Please select a component to apply Post-Prop Star treatment',
        success: false
      });
    } else {
      figma.notify('Please select a component to apply Post-Prop Star treatment');
    }
    return;
  }

  let treatedCount = 0;

  selection.forEach(component => {
    if (component.type !== 'COMPONENT' && component.type !== 'COMPONENT_SET') {
      if (!isDirectCommand) {
        figma.ui.postMessage({
          type: 'status',
          message: `Selected node type: ${component.type}. Please select components or component sets only`,
          success: false
        });
      } else {
        figma.notify(`Selected node type: ${component.type}. Please select components or component sets only`);
      }
      return;
    }

    const parent = component.parent;
    if (!parent || parent.type === 'PAGE') {
      if (!isDirectCommand) {
        figma.ui.postMessage({
          type: 'status',
          message: 'Component must have a parent frame',
          success: false
        });
      } else {
        figma.notify('Component must have a parent frame');
      }
      return;
    }

    // Find sibling frame with empty name (Prop Star documentation frame)
    const siblings = parent.children;
    const componentIndex = siblings.indexOf(component);
    
    // Look for empty frame that's a sibling, typically the previous one
    let docFrame = null;
    
    // First check the previous sibling (most common case)
    if (componentIndex > 0) {
      const prevSibling = siblings[componentIndex - 1];
      if (prevSibling.type === 'FRAME' && (prevSibling.name === '' || prevSibling.name === ' ')) {
        docFrame = prevSibling;
      }
    }
    
    // If not found, search all siblings for an empty frame
    if (!docFrame) {
      docFrame = siblings.find(sibling => 
        sibling !== component && 
        sibling.type === 'FRAME' && 
        (sibling.name === '' || sibling.name === ' ')
      );
    }

    if (!docFrame) {
      if (!isDirectCommand) {
        figma.ui.postMessage({
          type: 'status',
          message: `No empty documentation frame found for "${component.name}"`,
          success: false
        });
      } else {
        figma.notify(`No empty documentation frame found for "${component.name}"`);
      }
      return;
    }

    // 1. Give the documentation frame the component's name
    docFrame.name = component.name;

    // 2. Unlock the documentation frame
    docFrame.locked = false;

    // 3. Find the "Instances" frame to get its position
    const instancesFrame = docFrame.children.find(child => child.name === 'Instances');
    let targetX = 0;
    let targetY = 0;
    
    if (instancesFrame) {
      targetX = instancesFrame.x;
      targetY = instancesFrame.y;
    }
    
    // 4. Move component inside documentation frame
    docFrame.appendChild(component);
    
    // 5. Position component at the same x/y position as the Instances frame
    component.x = targetX;
    component.y = targetY;

    treatedCount++;
  });

  if (treatedCount > 0) {
    const componentText = treatedCount === 1 ? 'component' : 'components';
    if (!isDirectCommand) {
      figma.ui.postMessage({
        type: 'status',
        message: `Applied Post-Prop Star treatment to ${treatedCount} ${componentText}`,
        success: true
      });
    } else {
      figma.notify(`Applied Post-Prop Star treatment to ${treatedCount} ${componentText}`);
    }
  }
}

function handlePropStarCleanup(isDirectCommand = false) {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    if (!isDirectCommand) {
      figma.ui.postMessage({
        type: 'status',
        message: 'Please select a frame to clean up Prop Star elements',
        success: false
      });
    } else {
      figma.notify('Please select a frame to clean up Prop Star elements');
    }
    return;
  }

  let cleanedCount = 0;
  const componentsToSelect = [];
  const framesToProcess = [];

  selection.forEach(node => {
    if (node.type === 'FRAME') {
      // Direct frame selection - use as-is
      framesToProcess.push(node);
    } else if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      // Component selected - find its parent frame
      const parent = node.parent;
      if (parent && parent.type === 'FRAME') {
        // Check if parent contains Prop Star elements
        const hasLabels = parent.children.some(child => 
          child.type === 'GROUP' && child.name.toLowerCase() === 'labels'
        );
        const hasInstances = parent.children.some(child => 
          child.type === 'FRAME' && child.name.toLowerCase() === 'instances'
        );
        
        if (hasLabels || hasInstances) {
          framesToProcess.push(parent);
        } else {
          if (!isDirectCommand) {
            figma.ui.postMessage({
              type: 'status',
              message: `No Prop Star elements found in parent frame of "${node.name}"`,
              success: false
            });
          } else {
            figma.notify(`No Prop Star elements found in parent frame of "${node.name}"`);
          }
          return;
        }
      } else {
        if (!isDirectCommand) {
          figma.ui.postMessage({
            type: 'status',
            message: `"${node.name}" must have a parent frame with Prop Star elements`,
            success: false
          });
        } else {
          figma.notify(`"${node.name}" must have a parent frame with Prop Star elements`);
        }
        return;
      }
    } else {
      if (!isDirectCommand) {
        figma.ui.postMessage({
          type: 'status',
          message: 'Please select frames or components to clean up Prop Star elements',
          success: false
        });
      } else {
        figma.notify('Please select frames or components to clean up Prop Star elements');
      }
      return;
    }
  });

  framesToProcess.forEach(node => {

    const children = [...node.children];
    let labelsFound = false;
    let instancesFound = false;
    let component = null;
    
    // Find and remove Labels group and Instances frame, identify the component
    children.forEach(child => {
      if (child.type === 'GROUP' && child.name.toLowerCase() === 'labels') {
        child.remove();
        labelsFound = true;
      } else if (child.type === 'FRAME' && child.name.toLowerCase() === 'instances') {
        child.remove();
        instancesFound = true;
      } else if (child.type === 'COMPONENT' || child.type === 'COMPONENT_SET') {
        component = child;
      }
    });

    if (!labelsFound && !instancesFound) {
      if (!isDirectCommand) {
        figma.ui.postMessage({
          type: 'status',
          message: `No Prop Star elements found in "${node.name}"`,
          success: false
        });
      } else {
        figma.notify(`No Prop Star elements found in "${node.name}"`);
      }
      return;
    }

    // If we found a component, ungroup the frame but preserve the component
    if (component) {
      const parent = node.parent;
      const nodeIndex = parent.children.indexOf(node);
      const nodeX = node.x;
      const nodeY = node.y;
      
      // Move component to parent at frame's position
      parent.insertChild(nodeIndex, component);
      component.x = nodeX;
      component.y = nodeY;
      
      // Add component to selection list
      componentsToSelect.push(component);
      
      // Remove the now-empty frame
      node.remove();
    }

    cleanedCount++;
  });

  // Update selection to the extracted components
  if (componentsToSelect.length > 0) {
    figma.currentPage.selection = componentsToSelect;
  }

  if (cleanedCount > 0) {
    const frameText = cleanedCount === 1 ? 'frame' : 'frames';
    if (!isDirectCommand) {
      figma.ui.postMessage({
        type: 'status',
        message: `De-Propstarred ${cleanedCount} ${frameText}`,
        success: true
      });
    } else {
      figma.notify(`De-Propstarred ${cleanedCount} ${frameText}`);
    }
  }
}

function handleSet32pxInnerSpacing() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select a component variant to set inner spacing',
      success: false
    });
    return;
  }

  let updatedCount = 0;

  selection.forEach(node => {
    // Check if the node supports auto layout
    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'COMPONENT_SET') {
      // Check if auto layout is enabled
      if (node.layoutMode !== 'NONE') {
        // Set padding to 32px on all sides
        node.paddingTop = 32;
        node.paddingRight = 32;
        node.paddingBottom = 32;
        node.paddingLeft = 32;
        
        // Set item spacing (gap between children) to 32px
        node.itemSpacing = 32;
        
        updatedCount++;
      } else {
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
    const layerText = updatedCount === 1 ? 'variant' : 'variants';
    figma.ui.postMessage({
      type: 'status',
      message: `Set 32px inner spacing on ${updatedCount} ${layerText}`,
      success: true
    });
  }
}

function handleResetComponentSetStyle() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select a component set to reset its style',
      success: false
    });
    return;
  }

  let resetCount = 0;

  selection.forEach(node => {
    if (node.type === 'COMPONENT_SET') {
      // Remove fills (transparent background)
      node.fills = [];
      
      // Reset stroke to default component set style: #9747FF, inside, 1px, dashed 10-5
      node.strokes = [{
        type: 'SOLID',
        color: { r: 0.592, g: 0.278, b: 1 } // #9747FF
      }];
      node.strokeWeight = 1;
      node.strokeAlign = 'INSIDE';
      node.dashPattern = [10, 5]; // 10px dash, 5px gap
      
      // Reset corner radius to 5px
      node.cornerRadius = 5;
      
      resetCount++;
    } else {
      figma.ui.postMessage({
        type: 'status',
        message: `"${node.name}" is not a component set`,
        success: false
      });
      return;
    }
  });

  if (resetCount > 0) {
    const setText = resetCount === 1 ? 'component set' : 'component sets';
    figma.ui.postMessage({
      type: 'status',
      message: `Reset default component set style on ${resetCount} ${setText}`,
      success: true
    });
  }
}

function handleDetectComponents() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select frames to scan for component violations',
      success: false
    });
    return;
  }

  const violations = [];
  let scannedFrames = 0;

  function scanNode(node, frameName) {
    if (node.type === 'COMPONENT') {
      // Check if it's a hidden component (starts with . or _)
      if (!node.name.startsWith('.') && !node.name.startsWith('_')) {
        violations.push({
          frameName: frameName,
          componentName: node.name,
          nodeId: node.id
        });
      }
    }

    // Recursively scan children
    if ('children' in node) {
      node.children.forEach(child => scanNode(child, frameName));
    }
  }

  selection.forEach(node => {
    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      scannedFrames++;
      scanNode(node, node.name);
    }
  });

  if (scannedFrames === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: 'Please select frames, components, or instances to scan',
      success: false
    });
    return;
  }

  if (violations.length === 0) {
    figma.ui.postMessage({
      type: 'status',
      message: `✅ No component violations found in ${scannedFrames} frame(s). All components are properly hidden (start with . or _) or are instances.`,
      success: true
    });
  } else {
    const violationText = violations.length === 1 ? 'violation' : 'violations';
    let message = `⚠️ Found ${violations.length} component ${violationText} in ${scannedFrames} frame(s):\n\n`;
    
    violations.forEach((violation, index) => {
      message += `${index + 1}. "${violation.componentName}" in "${violation.frameName}"\n`;
    });
    
    message += '\nGuideline: Screen designs should only contain hidden components (starting with . or _) or instances, not published components.';

    figma.ui.postMessage({
      type: 'status',
      message: message,
      success: false
    });
  }
}