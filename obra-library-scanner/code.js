figma.showUI(__html__, { width: 420, height: 600 });

let librariesFound = [];
let foundElements = []; // Store actual elements with node references
let scanCancelled = false;
let currentScanId = null;
let currentScanType = null;

// Performance constants
const BATCH_SIZE = 50; // Process nodes in batches
const BATCH_DELAY = 10; // ms delay between batches


// Get all pages in the document
function getAllPages() {
  return figma.root.children.filter(node => node.type === 'PAGE');
}


// Get all local styles by type
async function getLocalStyles() {
  return {
    fillStyles: await figma.getLocalPaintStylesAsync(),
    textStyles: await figma.getLocalTextStylesAsync(),
    effectStyles: await figma.getLocalEffectStylesAsync()
  };
}

// Get all local variables
async function getLocalVariables() {
  console.log('Getting local variable collections...');
  const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
  console.log(`Found ${localCollections.length} local collections`);
  
  const localVariables = [];
  
  for (const collection of localCollections) {
    console.log(`Processing collection: ${collection.name} with ${collection.variableIds.length} variables`);
    
    for (const variableId of collection.variableIds) {
      try {
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (variable) {
          localVariables.push(variable);
          console.log(`Added variable: ${variable.name} (remote: ${variable.remote || false})`);
        }
      } catch (error) {
        console.error('Error getting local variable:', error);
      }
    }
  }
  
  console.log(`Total local variables collected: ${localVariables.length}`);
  return localVariables;
}

// Find local style by name and type
async function findLocalStyleByName(styleName, styleType) {
  const localStyles = await getLocalStyles();
  
  switch (styleType) {
    case 'fill style':
      return localStyles.fillStyles.find(style => style.name === styleName);
    case 'text style':
      return localStyles.textStyles.find(style => style.name === styleName);
    case 'effect style':
      return localStyles.effectStyles.find(style => style.name === styleName);
    default:
      return null;
  }
}

// Find local variable by name
async function findLocalVariableByName(variableName) {
  console.log(`Searching for local variable with name: ${variableName}`);
  const localVariables = await getLocalVariables();
  console.log(`Found ${localVariables.length} local variables`);
  
  const matchingVariable = localVariables.find(variable => {
    const matches = variable.name === variableName;
    if (matches) {
      console.log(`Found matching variable: ${variable.name}`);
    }
    return matches;
  });
  
  if (!matchingVariable) {
    console.log(`No local variable found with exact name: ${variableName}`);
    console.log('Available local variable names:', localVariables.map(v => v.name));
  }
  
  return matchingVariable;
}

// Find local component by name (searches current page first, then loads all if needed)
async function findLocalComponentByName(componentName) {
  // First, try to find in the current page
  function searchInNode(node) {
    const components = [];
    
    if (node.type === 'COMPONENT' && node.name === componentName && !node.remote) {
      components.push(node);
    }
    
    if ('children' in node) {
      for (const child of node.children) {
        components.push(...searchInNode(child));
      }
    }
    
    return components;
  }
  
  // Search current page first
  const currentPageComponents = searchInNode(figma.currentPage);
  if (currentPageComponents.length > 0) {
    return currentPageComponents[0];
  }
  
  // If not found, try to find in local component library (if we have access)
  // Note: We avoid loading all pages unless absolutely necessary for performance
  try {
    // Try to get local components from the library
    const localPaintStyles = await figma.getLocalPaintStylesAsync(); // This is a workaround to check if we have library access
    
    // If we reach here and still no component, we might need to search other pages
    // But for performance, we'll return null instead of loading all pages
    return null;
  } catch (error) {
    console.error('Error searching for local component:', error);
    return null;
  }
}

// Auto-fix remote styles by replacing with local ones
async function autoFixRemoteStyles(scanType = 'current') {
  let fixCount = 0;
  
  try {
    figma.ui.postMessage({
      type: 'fix-started',
      scanType: scanType
    });
    
    if (scanType === 'selection') {
      // Fix only selected nodes
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.ui.postMessage({
          type: 'scan-error',
          message: 'No selection found'
        });
        return 0;
      }
      
      for (const node of selection) {
        fixCount += await autoFixNodeStyles(node);
      }
    } else if (scanType === 'all') {
      // Load all pages first
      await figma.loadAllPagesAsync();
      const pagesToScan = getAllPages();
      
      for (const page of pagesToScan) {
        fixCount += await autoFixPageStyles(page);
      }
    } else {
      // Fix current page
      fixCount += await autoFixPageStyles(figma.currentPage);
    }
  
    figma.ui.postMessage({
      type: 'fix-complete',
      fixCount: fixCount,
      scanType: scanType
    });
    
    return fixCount;
    
  } catch (error) {
    console.error('Error during auto-fix:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error occurred during auto-fix: ' + error.message
    });
  }
}

// Auto-fix styles in a specific node and its children
async function autoFixNodeStyles(rootNode) {
  let fixCount = 0;
  
  async function fixNodeStyles(node) {
    // Skip the page node itself
    if (node.type === 'PAGE') {
      if ('children' in node) {
        for (const child of node.children) {
          fixCount += await fixNodeStyles(child);
        }
      }
      return fixCount;
    }
    
    // Check and fix fill styles
    if ('fillStyleId' in node && node.fillStyleId) {
      const styleId = node.fillStyleId;
      if (typeof styleId === 'string') {
        try {
          const style = await figma.getStyleByIdAsync(styleId);
          if (style && style.remote) {
            const localStyle = await findLocalStyleByName(style.name, 'fill style');
            if (localStyle) {
              await node.setFillStyleIdAsync(localStyle.id);
              fixCount++;
            }
          }
        } catch (error) {
          console.error('Error getting fill style:', error);
        }
      }
    }
    
    // Check and fix text styles
    if ('textStyleId' in node && node.textStyleId) {
      const styleId = node.textStyleId;
      if (typeof styleId === 'string') {
        try {
          const style = await figma.getStyleByIdAsync(styleId);
          if (style && style.remote) {
            const localStyle = await findLocalStyleByName(style.name, 'text style');
            if (localStyle) {
              await node.setTextStyleIdAsync(localStyle.id);
              fixCount++;
            }
          }
        } catch (error) {
          console.error('Error getting text style:', error);
        }
      }
    }
    
    // Check and fix effect styles
    if ('effectStyleId' in node && node.effectStyleId) {
      const styleId = node.effectStyleId;
      if (typeof styleId === 'string') {
        try {
          const style = await figma.getStyleByIdAsync(styleId);
          if (style && style.remote) {
            const localStyle = await findLocalStyleByName(style.name, 'effect style');
            if (localStyle) {
              await node.setEffectStyleIdAsync(localStyle.id);
              fixCount++;
            }
          }
        } catch (error) {
          console.error('Error getting effect style:', error);
        }
      }
    }
    
    // Check and fix bound variables
    if ('boundVariables' in node && node.boundVariables) {
      for (const [property, variableAlias] of Object.entries(node.boundVariables)) {
        if (variableAlias && typeof variableAlias === 'object' && 'id' in variableAlias) {
          try {
            const variable = await figma.variables.getVariableByIdAsync(variableAlias.id);
            if (variable && variable.remote) {
              const localVariable = await findLocalVariableByName(variable.name);
              if (localVariable) {
                // Update the bound variable to use the local one
                await node.setBoundVariableAsync(property, {
                  type: 'VARIABLE_ALIAS',
                  id: localVariable.id
                });
                fixCount++;
              }
            }
          } catch (error) {
            console.error('Error fixing variable:', error);
          }
        }
      }
    }
    
    // Recursively fix children
    if ('children' in node) {
      for (const child of node.children) {
        fixCount += await fixNodeStyles(child);
      }
    }
    
    return 0; // Individual node doesn't return count, only accumulated in fixCount
  }
  
  await fixNodeStyles(rootNode);
  return fixCount;
}

// Auto-fix styles in a specific page
async function autoFixPageStyles(page) {
  return await autoFixNodeStyles(page);
}

// Scan current page for all libraries used
async function scanCurrentPage() {
  librariesFound = [];
  foundElements = [];
  scanCancelled = false;
  currentScanId = Date.now().toString();
  currentScanType = 'current';
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
      pageName: currentPage.name,
      scanType: 'current',
      scanId: currentScanId
    });
    
    // Scan all nodes in the current page with batching
    await scanNodeWithBatching(currentPage);
    
    if (!scanCancelled) {
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
        messageType: messageType,
        scanType: 'current'
      });
    }
    
  } catch (error) {
    console.error('Error during scan:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error occurred during scan: ' + error.message
    });
  }
}

// Scan all pages in the document
async function scanAllPages() {
  librariesFound = [];
  foundElements = [];
  scanCancelled = false;
  currentScanId = Date.now().toString();
  currentScanType = 'all';
  
  try {
    // Load all pages first
    await figma.loadAllPagesAsync();
    const allPages = getAllPages();
    
    if (allPages.length === 0) {
      figma.ui.postMessage({
        type: 'scan-complete',
        libraries: [],
        message: 'No pages found in document'
      });
      return;
    }
    
    // Send scan started info to UI
    figma.ui.postMessage({
      type: 'scan-started',
      pageName: `All Pages (${allPages.length} pages)`,
      scanType: 'all',
      scanId: currentScanId
    });
    
    // Scan all pages with batch processing
    for (let i = 0; i < allPages.length; i++) {
      if (scanCancelled) {
        figma.ui.postMessage({
          type: 'scan-cancelled',
          message: 'Scan was cancelled'
        });
        return;
      }
      
      const page = allPages[i];
      
      // Send progress update
      figma.ui.postMessage({
        type: 'scan-progress',
        currentPage: page.name,
        progress: i + 1,
        total: allPages.length
      });
      
      await scanNodeWithBatching(page);
      
      // No element limit - scan everything
    }
    
    if (!scanCancelled) {
      // Remove duplicates and sort
      const uniqueLibraries = removeDuplicateLibraries(librariesFound);
      
      // Determine message based on what was found
      const hasRemoteLibraries = uniqueLibraries.some(lib => lib.type === 'remote');
      const hasLocalLibraries = uniqueLibraries.some(lib => lib.type === 'local');
      
      let message, messageType;
      if (uniqueLibraries.length === 0) {
        message = 'No libraries found in any page';
        messageType = 'info';
      } else if (hasRemoteLibraries) {
        message = 'Please convert the remote styles to local styles';
        messageType = 'error';
      } else if (hasLocalLibraries) {
        message = 'Everything clean, everything local';
        messageType = 'success';
      } else {
        message = `Found ${uniqueLibraries.length} libraries used across all pages`;
        messageType = 'info';
      }
      
      figma.ui.postMessage({
        type: 'scan-complete',
        libraries: uniqueLibraries,
        pageName: `All Pages (${allPages.length} pages)`,
        message: message,
        messageType: messageType,
        scanType: 'all'
      });
    }
    
  } catch (error) {
    console.error('Error during scan:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error occurred during scan: ' + error.message
    });
  }
}

// Batch processing wrapper for large node scans
async function scanNodeWithBatching(rootNode) {
  const nodesToScan = [];
  
  // Collect all nodes first
  function collectNodes(node) {
    nodesToScan.push(node);
    if ('children' in node) {
      for (const child of node.children) {
        collectNodes(child);
      }
    }
  }
  
  collectNodes(rootNode);
  
  // Process nodes in batches
  for (let i = 0; i < nodesToScan.length; i += BATCH_SIZE) {
    if (scanCancelled) {
      break;
    }
    
    const batch = nodesToScan.slice(i, i + BATCH_SIZE);
    
    // Process batch
    for (const node of batch) {
      if (scanCancelled) {
        break;
      }
      await scanSingleNode(node);
    }
    
    // Send progress update for large scans
    if (nodesToScan.length > 200 && i % (BATCH_SIZE * 2) === 0) {
      figma.ui.postMessage({
        type: 'scan-node-progress',
        processed: Math.min(i + BATCH_SIZE, nodesToScan.length),
        total: nodesToScan.length
      });
    }
    
    // Small delay to prevent UI blocking
    if (BATCH_DELAY > 0) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }
}

// Legacy recursive function - now calls batching version
async function scanNodeRecursively(node) {
  await scanNodeWithBatching(node);
}

// Timeout wrapper for async operations
async function withTimeout(asyncFn, timeoutMs = 5000) {
  return Promise.race([
    asyncFn(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
    )
  ]);
}

// Scan a single node for library usage
async function scanSingleNode(node) {
  // Skip page nodes
  if (node.type === 'PAGE') {
    return;
  }

  // Check component instances
  if (node.type === 'INSTANCE') {
    try {
      const mainComponent = await withTimeout(() => node.getMainComponentAsync(), 3000);
      if (mainComponent) {
        const elementId = generateElementId();
        foundElements.push({
          id: elementId,
          nodeId: node.id,
          nodeName: node.name
        });

        if (mainComponent.remote) {
          // Remote component
          addLibrary({
            name: mainComponent.remote.name || 'Unknown Remote Library',
            id: mainComponent.key.split('/')[0],
            type: 'remote',
            elementType: 'component',
            elementName: mainComponent.name,
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
            elementName: mainComponent.name,
            elementId: elementId,
            nodeName: node.name
          });
        }
      }
    } catch (error) {
      console.error('Error getting main component:', error);
    }
  }
  
  // Check fill styles
  if ('fillStyleId' in node && node.fillStyleId) {
    const styleId = node.fillStyleId;
    if (typeof styleId === 'string') {
      try {
        const style = await withTimeout(() => figma.getStyleByIdAsync(styleId), 2000);
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
      } catch (error) {
        console.error('Error getting fill style:', error);
      }
    }
  }
  
  // Check text styles
  if ('textStyleId' in node && node.textStyleId) {
    const styleId = node.textStyleId;
    if (typeof styleId === 'string') {
      try {
        const style = await withTimeout(() => figma.getStyleByIdAsync(styleId), 2000);
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
      } catch (error) {
        console.error('Error getting text style:', error);
      }
    }
  }
  
  // Check effect styles
  if ('effectStyleId' in node && node.effectStyleId) {
    const styleId = node.effectStyleId;
    if (typeof styleId === 'string') {
      try {
        const style = await withTimeout(() => figma.getStyleByIdAsync(styleId), 2000);
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
      } catch (error) {
        console.error('Error getting effect style:', error);
      }
    }
  }
  
  // Check bound variables
  if ('boundVariables' in node && node.boundVariables) {
    for (const [property, variableAlias] of Object.entries(node.boundVariables)) {
      if (variableAlias && typeof variableAlias === 'object' && 'id' in variableAlias) {
        try {
          const variable = await withTimeout(() => figma.variables.getVariableByIdAsync(variableAlias.id), 2000);
          if (variable) {
            const elementId = generateElementId();
            foundElements.push({
              id: elementId,
              nodeId: node.id,
              nodeName: node.name
            });

            if (variable.remote) {
              // Remote variable
              addLibrary({
                name: variable.remote.name || 'Unknown Remote Library',
                id: variable.key.split('/')[0],
                type: 'remote',
                elementType: 'variable',
                elementName: `${variable.name} (${property})`,
                elementId: elementId,
                nodeName: node.name
              });
            } else {
              // Local variable
              addLibrary({
                name: 'Local Variables',
                id: 'local',
                type: 'local',
                elementType: 'variable',
                elementName: `${variable.name} (${property})`,
                elementId: elementId,
                nodeName: node.name
              });
            }
          }
        } catch (error) {
          console.error('Error getting variable:', error);
        }
      }
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


// Handle fixing individual element
async function handleFixIndividualElement(elementId, libraryName) {
  const element = foundElements.find(el => el.id === elementId);
  
  if (!element) {
    figma.ui.postMessage({
      type: 'individual-fix-complete',
      elementId: elementId,
      success: false,
      error: 'Element not found'
    });
    return;
  }
  
  try {
    const node = await figma.getNodeByIdAsync(element.nodeId);
    if (!node) {
      figma.ui.postMessage({
        type: 'individual-fix-complete',
        elementId: elementId,
        success: false,
        error: 'Node not found'
      });
      return;
    }
    
    let fixCount = 0;
    let elementName = '';
    
    // Check and fix component instances
    if (node.type === 'INSTANCE' && 'getMainComponentAsync' in node) {
      try {
        const mainComponent = await withTimeout(() => node.getMainComponentAsync(), 3000);
        if (mainComponent && mainComponent.remote) {
          // Find local component with same name
          const localComponent = await findLocalComponentByName(mainComponent.name);
          if (localComponent) {
            await node.swapComponentAsync(localComponent);
            fixCount++;
            elementName = mainComponent.name;
          }
        }
      } catch (error) {
        console.error('Error fixing component:', error);
      }
    }
    
    // Check and fix fill styles
    if ('fillStyleId' in node && node.fillStyleId && typeof node.fillStyleId === 'string') {
      try {
        const style = await withTimeout(() => figma.getStyleByIdAsync(node.fillStyleId), 2000);
        if (style && style.remote) {
          const localStyle = await findLocalStyleByName(style.name, 'fill style');
          if (localStyle) {
            await node.setFillStyleIdAsync(localStyle.id);
            fixCount++;
            elementName = style.name;
          }
        }
      } catch (error) {
        console.error('Error fixing fill style:', error);
      }
    }
    
    // Check and fix text styles
    if ('textStyleId' in node && node.textStyleId && typeof node.textStyleId === 'string') {
      try {
        const style = await withTimeout(() => figma.getStyleByIdAsync(node.textStyleId), 2000);
        if (style && style.remote) {
          const localStyle = await findLocalStyleByName(style.name, 'text style');
          if (localStyle) {
            await node.setTextStyleIdAsync(localStyle.id);
            fixCount++;
            elementName = style.name;
          }
        }
      } catch (error) {
        console.error('Error fixing text style:', error);
      }
    }
    
    // Check and fix effect styles
    if ('effectStyleId' in node && node.effectStyleId && typeof node.effectStyleId === 'string') {
      try {
        const style = await withTimeout(() => figma.getStyleByIdAsync(node.effectStyleId), 2000);
        if (style && style.remote) {
          const localStyle = await findLocalStyleByName(style.name, 'effect style');
          if (localStyle) {
            await node.setEffectStyleIdAsync(localStyle.id);
            fixCount++;
            elementName = style.name;
          }
        }
      } catch (error) {
        console.error('Error fixing effect style:', error);
      }
    }
    
    // Check and fix bound variables
    if ('boundVariables' in node && node.boundVariables) {
      console.log('Checking bound variables on node:', node.name);
      console.log('Bound variables:', node.boundVariables);
      
      for (const [property, variableAlias] of Object.entries(node.boundVariables)) {
        console.log(`Processing property: ${property}`, variableAlias);
        
        if (variableAlias && typeof variableAlias === 'object' && 'id' in variableAlias) {
          try {
            console.log(`Fetching variable with ID: ${variableAlias.id}`);
            const variable = await withTimeout(() => figma.variables.getVariableByIdAsync(variableAlias.id), 2000);
            
            if (variable) {
              console.log(`Found variable: ${variable.name}, remote: ${variable.remote}`);
              
              if (variable.remote) {
                console.log(`Variable is remote, searching for local equivalent: ${variable.name}`);
                const localVariable = await findLocalVariableByName(variable.name);
                
                if (localVariable) {
                  console.log(`Found local variable: ${localVariable.name} with ID: ${localVariable.id}`);
                  console.log(`Attempting to bind variable for property: ${property}`);
                  
                  await node.setBoundVariableAsync(property, {
                    type: 'VARIABLE_ALIAS',
                    id: localVariable.id
                  });
                  
                  fixCount++;
                  elementName = `${variable.name} (${property})`;
                  console.log(`Successfully fixed variable: ${elementName}`);
                } else {
                  console.log(`No local variable found with name: ${variable.name}`);
                }
              } else {
                console.log(`Variable ${variable.name} is already local, skipping`);
              }
            } else {
              console.log(`Could not fetch variable with ID: ${variableAlias.id}`);
            }
          } catch (error) {
            console.error(`Error fixing variable for property ${property}:`, error);
            console.error('Error details:', error.message, error.stack);
          }
        } else {
          console.log(`Skipping property ${property} - invalid variableAlias structure`);
        }
      }
    } else {
      console.log('Node has no bound variables');
    }
    
    figma.ui.postMessage({
      type: 'individual-fix-complete',
      elementId: elementId,
      success: fixCount > 0,
      elementName: elementName || element.nodeName,
      error: fixCount === 0 ? 'No matching local style/component found' : null
    });
    
  } catch (error) {
    console.error('Error fixing individual element:', error);
    figma.ui.postMessage({
      type: 'individual-fix-complete',
      elementId: elementId,
      success: false,
      error: error.message
    });
  }
}

// Handle inspect element functionality
async function handleInspectElement(elementId) {
  const element = foundElements.find(el => el.id === elementId);
  
  if (!element) {
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Element not found. Try scanning again.'
    });
    return;
  }
  
  if (!element.nodeId) {
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Element has no node ID. Try scanning again.'
    });
    return;
  }
  
  try {
    const node = await figma.getNodeByIdAsync(element.nodeId);
    if (!node) {
      figma.ui.postMessage({
        type: 'scan-error',
        message: 'Node not found. It may have been deleted or moved to another page.'
      });
      return;
    }
    
    // Find the page that contains this node
    let currentNode = node;
    let containingPage = null;
    
    while (currentNode && currentNode.type !== 'PAGE') {
      currentNode = currentNode.parent;
    }
    
    if (currentNode && currentNode.type === 'PAGE') {
      containingPage = currentNode;
      
      // Switch to the correct page if needed
      if (containingPage !== figma.currentPage) {
        await figma.setCurrentPageAsync(containingPage);
      }
    }
    
    // Now select and zoom to the node
    // Note: selection doesn't have an async setter, but we need to ensure we're on the right page first
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    
    figma.ui.postMessage({
      type: 'element-selected',
      elementId: elementId,
      nodeName: element.nodeName
    });
    
  } catch (error) {
    console.error('Error inspecting element:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error accessing node: ' + error.message
    });
  }
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

// Scan current selection for all libraries used
async function scanCurrentSelection() {
  librariesFound = [];
  foundElements = [];
  scanCancelled = false;
  currentScanId = Date.now().toString();
  currentScanType = 'selection';
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'scan-complete',
      libraries: [],
      message: 'No selection found',
      scanType: 'selection'
    });
    return;
  }
  
  try {
    // Send scan started info to UI
    figma.ui.postMessage({
      type: 'scan-started',
      pageName: `Selection (${selection.length} item${selection.length !== 1 ? 's' : ''})`,
      scanType: 'selection',
      scanId: currentScanId
    });
    
    // Scan all selected nodes with batching
    for (const node of selection) {
      if (scanCancelled) {
        figma.ui.postMessage({
          type: 'scan-cancelled',
          message: 'Scan was cancelled'
        });
        return;
      }
      await scanNodeWithBatching(node);
    }
    
    if (!scanCancelled) {
      // Remove duplicates and sort
      const uniqueLibraries = removeDuplicateLibraries(librariesFound);
      
      // Determine message based on what was found
      const hasRemoteLibraries = uniqueLibraries.some(lib => lib.type === 'remote');
      const hasLocalLibraries = uniqueLibraries.some(lib => lib.type === 'local');
      
      let message, messageType;
      if (uniqueLibraries.length === 0) {
        message = 'No libraries found in selection';
        messageType = 'info';
      } else if (hasRemoteLibraries) {
        message = 'Please convert the remote styles to local styles';
        messageType = 'error';
      } else if (hasLocalLibraries) {
        message = 'Everything clean, everything local';
        messageType = 'success';
      } else {
        message = `Found ${uniqueLibraries.length} libraries used in selection`;
        messageType = 'info';
      }
      
      figma.ui.postMessage({
        type: 'scan-complete',
        libraries: uniqueLibraries,
        pageName: `Selection (${selection.length} item${selection.length !== 1 ? 's' : ''})`,
        message: message,
        messageType: messageType,
        scanType: 'selection'
      });
    }
    
  } catch (error) {
    console.error('Error during scan:', error);
    figma.ui.postMessage({
      type: 'scan-error',
      message: 'Error occurred during scan: ' + error.message
    });
  }
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'scan-current':
      await scanCurrentPage();
      break;
      
    case 'scan-all':
      await scanAllPages();
      break;
      
    case 'scan-selection':
      await scanCurrentSelection();
      break;
      
      
    case 'fix-current':
      await autoFixRemoteStyles('current');
      break;
      
    case 'fix-all':
      await autoFixRemoteStyles('all');
      break;
      
    case 'fix-selection':
      await autoFixRemoteStyles('selection');
      break;
      
    case 'cancel-scan':
      scanCancelled = true;
      break;
      
    case 'scan':
      // Backward compatibility
      await scanCurrentPage();
      break;
      
    case 'inspect-element':
      await handleInspectElement(msg.elementId);
      break;
      
    case 'fix-individual-element':
      await handleFixIndividualElement(msg.elementId, msg.libraryName);
      break;
      
    case 'close':
      figma.closePlugin();
      break;
  }
};