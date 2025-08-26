figma.showUI(__html__, { width: 420, height: 600 });

let librariesFound = [];
let foundElements = []; // Store actual elements with node references

// Scan current page for all libraries used
async function scanCurrentPage() {
  librariesFound = [];
  const currentPage = figma.currentPage;
  
  if (!currentPage) {
    figma.ui.postMessage({
      type: 'scan-complete',
      libraries: [],
      message: 'No page selected'
    });
    return;
  }
  
  try {
    // Send page info to UI
    figma.ui.postMessage({
      type: 'scan-started',
      pageName: currentPage.name
    });
    
    // Scan all nodes in the current page
    await scanNodeRecursively(currentPage);
    
    // Remove duplicates and sort
    const uniqueLibraries = removeDuplicateLibraries(librariesFound);
    
    // Determine message based on what was found
    const hasRemoteLibraries = uniqueLibraries.some(lib => lib.type === 'remote');
    const hasLocalLibraries = uniqueLibraries.some(lib => lib.type === 'local');
    
    let message, messageType;
    if (uniqueLibraries.length === 0) {
      message = 'No libraries found on this page';
      messageType = 'info';
    } else if (hasRemoteLibraries) {
      message = 'Please convert the remote styles to local styles';
      messageType = 'error';
    } else if (hasLocalLibraries) {
      message = 'Everything clean, everything local';
      messageType = 'success';
    } else {
      message = `Found ${uniqueLibraries.length} libraries used on this page`;
      messageType = 'info';
    }
    
    figma.ui.postMessage({
      type: 'scan-complete',
      libraries: uniqueLibraries,
      pageName: currentPage.name,
      message: message,
      messageType: messageType
    });
    
  } catch (error) {
    console.error('Error during scan:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error occurred during scan: ' + error.message
    });
  }
}

async function scanNodeRecursively(node) {
  // Skip the page node itself
  if (node.type === 'PAGE') {
    if ('children' in node) {
      for (const child of node.children) {
        await scanNodeRecursively(child);
      }
    }
    return;
  }

  // Check component instances
  if (node.type === 'INSTANCE' && node.mainComponent) {
    const elementId = generateElementId();
    foundElements.push({
      id: elementId,
      nodeId: node.id,
      nodeName: node.name
    });

    if (node.mainComponent.remote) {
      // Remote component
      addLibrary({
        name: node.mainComponent.remote.name || 'Unknown Remote Library',
        id: node.mainComponent.key.split('/')[0],
        type: 'remote',
        elementType: 'component',
        elementName: node.mainComponent.name,
        elementId: elementId,
        nodeName: node.name
      });
    } else {
      // Local component
      addLibrary({
        name: 'Local Components',
        id: 'local',
        type: 'local',
        elementType: 'component',
        elementName: node.mainComponent.name,
        elementId: elementId,
        nodeName: node.name
      });
    }
  }
  
  // Check fill styles
  if ('fillStyleId' in node && node.fillStyleId) {
    const styleId = node.fillStyleId;
    if (typeof styleId === 'string') {
      const style = figma.getStyleById(styleId);
      if (style) {
        const elementId = generateElementId();
        foundElements.push({
          id: elementId,
          nodeId: node.id,
          nodeName: node.name
        });

        if (style.remote) {
          // Remote style
          addLibrary({
            name: style.remote.name || 'Unknown Remote Library',
            id: style.key.split('/')[0],
            type: 'remote',
            elementType: 'fill style',
            elementName: style.name,
            elementId: elementId,
            nodeName: node.name
          });
        } else {
          // Local style
          addLibrary({
            name: 'Local Styles',
            id: 'local',
            type: 'local',
            elementType: 'fill style',
            elementName: style.name,
            elementId: elementId,
            nodeName: node.name
          });
        }
      }
    }
  }
  
  // Check text styles
  if ('textStyleId' in node && node.textStyleId) {
    const styleId = node.textStyleId;
    if (typeof styleId === 'string') {
      const style = figma.getStyleById(styleId);
      if (style) {
        const elementId = generateElementId();
        foundElements.push({
          id: elementId,
          nodeId: node.id,
          nodeName: node.name
        });

        if (style.remote) {
          // Remote style
          addLibrary({
            name: style.remote.name || 'Unknown Remote Library',
            id: style.key.split('/')[0],
            type: 'remote',
            elementType: 'text style',
            elementName: style.name,
            elementId: elementId,
            nodeName: node.name
          });
        } else {
          // Local style
          addLibrary({
            name: 'Local Styles',
            id: 'local',
            type: 'local',
            elementType: 'text style',
            elementName: style.name,
            elementId: elementId,
            nodeName: node.name
          });
        }
      }
    }
  }
  
  // Check effect styles
  if ('effectStyleId' in node && node.effectStyleId) {
    const styleId = node.effectStyleId;
    if (typeof styleId === 'string') {
      const style = figma.getStyleById(styleId);
      if (style) {
        const elementId = generateElementId();
        foundElements.push({
          id: elementId,
          nodeId: node.id,
          nodeName: node.name
        });

        if (style.remote) {
          // Remote style
          addLibrary({
            name: style.remote.name || 'Unknown Remote Library',
            id: style.key.split('/')[0],
            type: 'remote',
            elementType: 'effect style',
            elementName: style.name,
            elementId: elementId,
            nodeName: node.name
          });
        } else {
          // Local style
          addLibrary({
            name: 'Local Styles',
            id: 'local',
            type: 'local',
            elementType: 'effect style',
            elementName: style.name,
            elementId: elementId,
            nodeName: node.name
          });
        }
      }
    }
  }
  
  // Recursively scan children
  if ('children' in node) {
    for (const child of node.children) {
      await scanNodeRecursively(child);
    }
  }
}

function generateElementId() {
  return 'element_' + Math.random().toString(36).substr(2, 9);
}

function addLibrary(libraryInfo) {
  // Always add each element instance
  librariesFound.push(libraryInfo);
}

function removeDuplicateLibraries(libraries) {
  const uniqueLibraries = {};
  
  libraries.forEach(lib => {
    if (!uniqueLibraries[lib.name]) {
      uniqueLibraries[lib.name] = {
        name: lib.name,
        id: lib.id,
        type: lib.type,
        elements: []
      };
    }
    
    // Add each element instance (don't deduplicate by name)
    uniqueLibraries[lib.name].elements.push({
      type: lib.elementType,
      name: lib.elementName,
      elementId: lib.elementId,
      nodeName: lib.nodeName
    });
  });
  
  // Convert to array and sort
  return Object.values(uniqueLibraries).sort((a, b) => {
    // Sort local first, then by name
    if (a.type === 'local' && b.type !== 'local') return -1;
    if (a.type !== 'local' && b.type === 'local') return 1;
    return a.name.localeCompare(b.name);
  });
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'scan':
      await scanCurrentPage();
      break;
      
    case 'inspect-element':
      const elementId = msg.elementId;
      const element = foundElements.find(el => el.id === elementId);
      if (element && element.nodeId) {
        const node = figma.getNodeById(element.nodeId);
        if (node) {
          figma.viewport.scrollAndZoomIntoView([node]);
          figma.currentPage.selection = [node];
          figma.ui.postMessage({
            type: 'element-selected',
            elementId: elementId,
            nodeName: element.nodeName
          });
        }
      }
      break;
      
    case 'close':
      figma.closePlugin();
      break;
  }
};