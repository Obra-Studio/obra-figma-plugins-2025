
// code.js
// Helper function to convert RGB to hex
function rgbToHex(r, g, b) {
  const toHex = (c) => {
    const hex = Math.round(c * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// Helper function to get hex color from a paint
async function getHexFromPaint(paint) {
  if (paint.type === 'SOLID') {
    // Check if it's a variable
    if (paint.boundVariables && paint.boundVariables.color) {
      try {
        const variable = await figma.variables.getVariableByIdAsync(paint.boundVariables.color.id);
        if (variable && variable.valuesByMode) {
          // Get the first mode's value
          const modeId = Object.keys(variable.valuesByMode)[0];
          const value = variable.valuesByMode[modeId];
          
          if (typeof value === 'object' && value.r !== undefined && value.g !== undefined && value.b !== undefined) {
            return rgbToHex(value.r, value.g, value.b);
          }
        }
      } catch (error) {
        console.error('Error resolving variable:', error);
      }
    }
    
    // Direct color value
    return rgbToHex(paint.color.r, paint.color.g, paint.color.b);
  }
  
  return null;
}

// Handle command
if (figma.command === 'extract-hex-colors') {
  processSelection();
}

// Main plugin function
async function processSelection() {
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.notify('Please select at least one object');
    return;
  }
  
  const results = [];
  
  for (const node of selection) {
    // Check if the node has fills
    if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
      const firstFill = node.fills[0];
      
      if (firstFill.visible !== false) {
        const hex = await getHexFromPaint(firstFill);
        
        if (hex) {
          results.push({node: node, hex: hex});
        }
      }
    }
  }
  
  if (results.length === 0) {
    figma.notify('No valid fills found in selected objects');
    return;
  }
  
  // Create text layers for each result
  for (const result of results) {
    const node = result.node;
    const hex = result.hex;
    
    // Create text node
    const textNode = figma.createText();
    
    // Load default font
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    
    // Set text properties
    textNode.characters = hex;
    textNode.fontSize = 12;
    textNode.fills = [{type: 'SOLID', color: {r: 0, g: 0, b: 0}}]; // Black text
    
    // Position the text node
    textNode.x = node.x;
    textNode.y = node.y + node.height + 8; // 8px below the object
    
    // Insert as sibling after the selected node
    const parent = node.parent;
    if (parent && parent.insertChild) {
      const nodeIndex = parent.children.indexOf(node);
      parent.insertChild(nodeIndex + 1, textNode);
    }
  }
  
  figma.notify(`Created ${results.length} hex color label(s)`);
  figma.closePlugin();
}