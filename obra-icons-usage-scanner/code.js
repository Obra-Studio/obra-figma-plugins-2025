// ES5 Figma Plugin Code - code.js
// This file handles the Figma API interaction

// Show the UI
figma.showUI(__html__, {
    width: 360,
    height: 500
  });
  
  // Function to check if a node name starts with "oi-"
  function startsWithOi(name) {
    return name.toLowerCase().indexOf('oi-') === 0;
  }
  
  // Function to scan all nodes recursively
  function scanNode(node, components, instances) {
    // Check if it's a component
    if (node.type === 'COMPONENT' && startsWithOi(node.name)) {
      components.push({
        id: node.id,
        name: node.name,
        type: 'COMPONENT'
      });
    }
    
    // Check if it's an instance
    if (node.type === 'INSTANCE' && startsWithOi(node.name)) {
      var mainComponentName = '';
      try {
        if (node.mainComponent) {
          mainComponentName = node.mainComponent.name;
        }
      } catch (e) {
        // Main component might not be accessible, try to get name from instance name
        mainComponentName = node.name;
      }
      
      // If still no main component name, use the instance name as fallback
      if (!mainComponentName) {
        mainComponentName = node.name;
      }
      
      instances.push({
        id: node.id,
        name: node.name,
        type: 'INSTANCE',
        mainComponentName: mainComponentName
      });
    }
    
    // Recursively scan children
    if ('children' in node) {
      for (var i = 0; i < node.children.length; i++) {
        scanNode(node.children[i], components, instances);
      }
    }
  }
  
  // Function to create instances from component names
  function createInstancesFrame(componentNames, instanceCounts) {
    try {
      // Create the main frame
      var frame = figma.createFrame();
      frame.name = "render used obra icons as instances";
      frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      
      var currentX = 0;
      var currentY = 0;
      var maxHeight = 0;
      var padding = 16;
      var instancesCreated = 0;
      
      // Find components in the current file to create instances from
      for (var i = 0; i < componentNames.length; i++) {
        var componentName = componentNames[i];
        
        // Skip library and unknown components for now
        if (componentName.indexOf('(Library)') !== -1 || componentName === 'Unknown Component') {
          continue;
        }
        
        // Find the component in the current file
        var foundComponent = null;
        for (var j = 0; j < figma.root.children.length; j++) {
          var page = figma.root.children[j];
          foundComponent = findComponentByName(page, componentName);
          if (foundComponent) break;
        }
        
        if (foundComponent) {
          // Create instance
          var instance = foundComponent.createInstance();
          instance.x = currentX;
          instance.y = currentY;
          
          // Add to frame
          frame.appendChild(instance);
          
          // Update position for next instance
          currentX += instance.width + padding;
          maxHeight = Math.max(maxHeight, instance.height);
          
          // Wrap to next row if needed (every 8 icons)
          if (instancesCreated > 0 && (instancesCreated + 1) % 8 === 0) {
            currentX = 0;
            currentY += maxHeight + padding;
            maxHeight = 0;
          }
          
          instancesCreated++;
        }
      }
      
      // Set frame size
      if (instancesCreated > 0) {
        frame.resize(Math.max(currentX, 8 * 40 + 7 * padding), currentY + maxHeight + padding);
        
        // Add to current page
        figma.currentPage.appendChild(frame);
        
        // Select and zoom to the frame
        figma.currentPage.selection = [frame];
        figma.viewport.scrollAndZoomIntoView([frame]);
      }
      
      return instancesCreated > 0;
    } catch (error) {
      console.error('Error creating frame:', error);
      return false;
    }
  }
  
  // Helper function to find component by name recursively
  function findComponentByName(node, name) {
    if (node.type === 'COMPONENT' && node.name === name) {
      return node;
    }
    
    if ('children' in node) {
      for (var i = 0; i < node.children.length; i++) {
        var found = findComponentByName(node.children[i], name);
        if (found) return found;
      }
    }
    
    return null;
  }
  
  // Handle messages from the UI
  figma.ui.onmessage = async function(msg) {
    if (msg.type === 'scan-file') {
      var components = [];
      var instances = [];
      
      // Load all pages first
      await figma.loadAllPagesAsync();
      
      // Scan all pages
      for (var i = 0; i < figma.root.children.length; i++) {
        var page = figma.root.children[i];
        scanNode(page, components, instances);
      }
      
      // Create a map of all component names for reference
      var componentNames = {};
      for (var i = 0; i < components.length; i++) {
        componentNames[components[i].name] = true;
      }
      
      // Group instances by main component name and count them
      var instanceCounts = {};
      for (var j = 0; j < instances.length; j++) {
        var instance = instances[j];
        var componentName = instance.mainComponentName;
        
        // If no main component name, classify as external/library component
        if (!componentName) {
          componentName = 'Unknown Component';
        } else if (!componentNames[componentName]) {
          // Component exists but not in this file (likely from library)
          componentName = componentName + ' (Library)';
        }
        
        if (!instanceCounts[componentName]) {
          instanceCounts[componentName] = 0;
        }
        instanceCounts[componentName]++;
      }
      
      // Send results back to UI
      figma.ui.postMessage({
        type: 'scan-complete',
        components: components,
        instances: instances,
        instanceCounts: instanceCounts
      });
    }
    
    if (msg.type === 'generate-frame') {
      try {
        // Load all pages first to access components
        await figma.loadAllPagesAsync();
        
        var success = createInstancesFrame(msg.componentNames, msg.instanceCounts);
        
        figma.ui.postMessage({
          type: 'frame-generated',
          success: success
        });
        
      } catch (error) {
        console.error('Frame generation error:', error);
        figma.ui.postMessage({
          type: 'frame-generated',
          success: false
        });
      }
    }
  };