// code.js
// Obra Instancer - Reorganizes component set variants into a uniform grid

// Handle UI messages
figma.ui.onmessage = async function(msg) {
  if (msg.type === 'run-step') {
    await handleStepExecution(msg.step, msg.debugMode, msg.data);
  } else if (msg.type === 'toggle-grid-lines') {
    toggleGridLineVisibility();
  } else if (msg.type === 'highlight-positions') {
    highlightVariantPositions();
  } else if (msg.type === 'get-selection-info') {
    getSelectionInfo();
  } else if (msg.type === 'debug-create-test-lines') {
    createDebugTestLines();
  } else if (msg.type === 'debug-clear-test-lines') {
    clearDebugTestLines();
  }
};

function getSelectionInfo() {
  var selection = figma.currentPage.selection;
  var info = {
    selectionCount: selection.length,
    selectionType: 'No selection',
    name: '-',
    size: '-',
    childrenCount: '-',
    componentChildren: '-',
    variantProperties: '-',
    fullSummary: 'No selection available'
  };
  
  if (selection.length > 0) {
    var node = selection[0];
    info.selectionType = node.type;
    info.name = node.name;
    info.size = Math.round(node.width) + '×' + Math.round(node.height) + 'px';
    
    if (node.children) {
      info.childrenCount = node.children.length + ' total';
      var componentChildren = node.children.filter(function(child) { return child.type === 'COMPONENT'; });
      info.componentChildren = componentChildren.length + ' components';
      
      if (node.type === 'COMPONENT_SET') {
        var propSummary = [];
        componentChildren.forEach(function(comp) {
          var props = comp.variantProperties || {};
          var propString = Object.keys(props).map(function(key) {
            return key + '=' + props[key];
          }).join(', ');
          if (propString) {
            propSummary.push(comp.name + ': {' + propString + '}');
          }
        });
        info.variantProperties = propSummary.length > 0 ? propSummary.join('; ') : 'No variant properties found';
      }
    } else {
      info.childrenCount = '0 (leaf node)';
      info.componentChildren = 'N/A';
    }
    
    // Create copy-pasteable summary
    info.fullSummary = 'SELECTION INFO:\n' +
      'Type: ' + info.selectionType + '\n' +
      'Name: ' + info.name + '\n' +
      'Size: ' + info.size + '\n' +
      'Children: ' + info.childrenCount + '\n' +
      'Components: ' + info.componentChildren + '\n' +
      'Properties: ' + info.variantProperties;
  }
  
  figma.ui.postMessage({
    type: 'selection-info',
    info: info
  });
}

// Command handling
console.log('Plugin started with command:', figma.command);

if (figma.command === 'step-builder') {
  // Show UI for step-by-step debugging
  figma.showUI(__html__, { width: 320, height: 600 });
  console.log('Step-by-Step Builder UI opened');
} else if (figma.command === 'create-table') {
  // Run main function directly for create-table command
  console.log('Running create-table command');
  main().catch(function(error) {
    console.error("Plugin error:", error);
    figma.notify("Plugin encountered an error. Check console for details.");
    figma.closePlugin();
  });
} else {
  // Default behavior - this shouldn't happen with the new menu structure
  console.log('No specific command, showing UI');
  figma.showUI(__html__, { width: 320, height: 600 });
}

async function handleStepExecution(stepNumber, debugMode, existingData) {
  try {
    let result;
    switch (stepNumber) {
      case 1:
        result = await executeStep1_ValidationSelection(debugMode);
        break;
      case 2:
        result = await executeStep2_ExtractVariants(debugMode, existingData);
        break;
      case 3:
        result = await executeStep3_AnalyzeProperties(debugMode, existingData);
        break;
      case 4:
        result = await executeStep4_CalculateGrid(debugMode, existingData);
        break;
      case 5:
        result = await executeStep5_Clean(debugMode, existingData, existingData.variants, existingData.gridLayout);
        break;
      case 6:
        result = await executeStep6_CreateGridLines(debugMode, existingData);
        break;
      case 7:
        result = await executeStep7_PositionVariants(debugMode, existingData);
        break;
      case 8:
        result = await executeStep8_AddLabels(debugMode, existingData);
        break;
      default:
        throw new Error(`Invalid step number: ${stepNumber}`);
    }
    
    figma.ui.postMessage({
      type: 'step-complete',
      step: stepNumber,
      success: true,
      data: result
    });
  } catch (error) {
    console.error(`Step ${stepNumber} failed:`, error);
    figma.ui.postMessage({
      type: 'step-complete',
      step: stepNumber,
      success: false,
      message: error.message
    });
  }
}

function toggleGridLineVisibility() {
  // Find grid lines in current selection and toggle opacity
  var selection = figma.currentPage.selection[0];
  if (selection && selection.type === 'COMPONENT_SET') {
    var wrapperFrame = selection.children.find(function(child) { return child.name.indexOf('Documentation') !== -1; });
    if (wrapperFrame) {
      var gridLines = wrapperFrame.children.filter(function(child) { return child.name.indexOf('Grid Line') !== -1; });
      gridLines.forEach(function(line) {
        line.opacity = line.opacity > 0.1 ? 0 : 0.5;
      });
      var isVisible = gridLines.length > 0 && gridLines[0].opacity > 0.1;
      figma.notify('Grid lines ' + (isVisible ? 'shown' : 'hidden'));
    }
  }
}

function highlightVariantPositions() {
  // Temporarily highlight variant positions
  var selection = figma.currentPage.selection[0];
  if (selection && selection.type === 'COMPONENT_SET') {
    var wrapperFrame = selection.children.find(function(child) { return child.name.indexOf('Documentation') !== -1; });
    if (wrapperFrame) {
      var variants = wrapperFrame.children.filter(function(child) { return child.type === 'COMPONENT'; });
      variants.forEach(function(variant, index) {
        var highlight = figma.createRectangle();
        highlight.resize(variant.width + 10, variant.height + 10);
        highlight.x = variant.x - 5;
        highlight.y = variant.y - 5;
        highlight.fills = [{ type: 'SOLID', color: { r: 1, g: 0.4, b: 0.2 }, opacity: 0.3 }];
        highlight.strokes = [{ type: 'SOLID', color: { r: 1, g: 0.4, b: 0.2 } }];
        highlight.strokeWeight = 2;
        highlight.name = "Highlight " + index;
        wrapperFrame.appendChild(highlight);
        
        // Remove highlight after 2 seconds
        setTimeout(function() {
          if (highlight.parent) highlight.remove();
        }, 2000);
      });
      figma.notify('Variant positions highlighted');
    }
  }
}

async function main() {
  console.log('Main function called - starting documentation table creation');
  
  // Load fonts first
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
  } catch (error) {
    console.log("Inter font not available, will use defaults");
  }
  // Check if something is selected
  if (figma.currentPage.selection.length === 0) {
    figma.notify("Please select a component set");
    if (figma.command !== 'step-builder') {
      figma.closePlugin();
    }
    return;
  }

  var selection = figma.currentPage.selection[0];
  
  // Must be a component set
  if (selection.type !== "COMPONENT_SET") {
    figma.notify("Please select a component set (not a single component)");
    figma.closePlugin();
    return;
  }

  var componentSet = selection;
  
  // Extract variant data
  var variantData = extractVariantData(componentSet);
  
  if (variantData.variants.length === 0) {
    figma.notify("No variants found in the selected component set");
    figma.closePlugin();
    return;
  }
  
  // Debug: Check if we're missing variants
  console.log("Component set children count:", componentSet.children.length);
  console.log("Detected variants count:", variantData.variants.length);
  
  // Create comprehensive debug dump
  createDebugDump(componentSet, variantData);

  // Reorganize the component set in place
  await reorganizeComponentSet(variantData, componentSet);
}

function extractVariantData(componentSet) {
  console.log("extractVariantData called with:", componentSet.name);
  var variants = [];
  var propertyNames = []; // Using array instead of Set for ES5 compatibility
  var defaultVariant = componentSet.defaultVariant;
  console.log("Default variant:", defaultVariant ? defaultVariant.name : "none");
  
  // Iterate through all children (variants) of the component set
  componentSet.children.forEach(function(child) {
    if (child.type === "COMPONENT") {
      var variantProps = child.variantProperties || {};
      
      // Add property names to our array (avoiding duplicates)
      Object.keys(variantProps).forEach(function(prop) {
        if (propertyNames.indexOf(prop) === -1) {
          propertyNames.push(prop);
        }
      });
      
      variants.push({
        name: child.name,
        properties: variantProps,
        component: child,
        isDefault: child === defaultVariant,
        originalX: child.x,
        originalY: child.y
      });
      
      // Debug: Log actual properties available on the component
      console.log("Component", child.name, "has properties:", Object.keys(child));
      console.log("  width:", child.width, "height:", child.height);
      console.log("  absoluteBoundingBox:", child.absoluteBoundingBox);
    }
  });
  
  console.log("Extracted", variants.length, "variants with properties:", propertyNames);
  
  return {
    componentName: componentSet.name,
    variants: variants,
    propertyNames: propertyNames.sort(),
    defaultVariant: defaultVariant
  };
}

// Helper function to safely get component dimensions
function getComponentDimensions(component) {
  var width = component.width;
  var height = component.height;
  
  // If width/height are undefined, try absoluteBoundingBox
  if (width === undefined || height === undefined) {
    if (component.absoluteBoundingBox) {
      width = component.absoluteBoundingBox.width;
      height = component.absoluteBoundingBox.height;
    }
  }
  
  // Final fallback to avoid NaN calculations
  if (width === undefined || width === null) width = 100;
  if (height === undefined || height === null) height = 40;
  
  return { width: width, height: height };
}

function analyzeProperties(variants, propertyNames) {
  var propertyAnalysis = [];
  
  propertyNames.forEach(function(propName) {
    var uniqueValues = getUniqueValues(variants.map(function(v) { 
      return v.properties[propName]; 
    })).sort();
    
    // Check for boolean properties (including On/Off)
    var isBoolean = uniqueValues.length === 2 && 
      (uniqueValues.includes("True") && uniqueValues.includes("False") ||
       uniqueValues.includes("true") && uniqueValues.includes("false") ||
       uniqueValues.includes("On") && uniqueValues.includes("Off") ||
       uniqueValues.includes("on") && uniqueValues.includes("off"));
    
    propertyAnalysis.push({
      name: propName,
      values: uniqueValues,
      count: uniqueValues.length,
      isBoolean: isBoolean
    });
  });
  
  // Sort properties: non-boolean first (by count descending), then boolean
  return propertyAnalysis.sort(function(a, b) {
    if (a.isBoolean && !b.isBoolean) return 1;
    if (!a.isBoolean && b.isBoolean) return -1;
    return b.count - a.count;
  });
}

// Helper function to get unique values from array
function getUniqueValues(array) {
  var unique = [];
  for (var i = 0; i < array.length; i++) {
    if (unique.indexOf(array[i]) === -1) {
      unique.push(array[i]);
    }
  }
  return unique;
}

function calculateGridLayout(variants, propertyAnalysis) {
  if (propertyAnalysis.length === 0) {
    // No properties - single row
    return {
      cols: variants.length,
      rows: 1,
      primaryProp: null,
      secondaryProp: null
    };
  } else if (propertyAnalysis.length === 1) {
    // Single property - single row
    var prop = propertyAnalysis[0];
    return {
      cols: prop.count,
      rows: 1,
      primaryProp: prop,
      secondaryProp: null
    };
  } else {
    // Two or more properties - use first two for grid
    var primaryProp = propertyAnalysis[0];
    var secondaryProp = propertyAnalysis[1];
    
    return {
      cols: primaryProp.count,
      rows: secondaryProp.count,
      primaryProp: primaryProp,
      secondaryProp: secondaryProp,
      additionalProps: propertyAnalysis.slice(2)
    };
  }
}

async function reorganizeComponentSet(variantData, componentSet) {
  var variants = variantData.variants;
  var propertyNames = variantData.propertyNames;
  
  // Constants for spacing
  var CELL_PADDING = 32;
  var FRAME_PADDING = 32;
  var LABEL_MARGIN = 24; // Space for labels
  var FIGMA_PURPLE = { r: 0.588, g: 0.278, b: 1 }; // #9647FF
  
  // Analyze properties
  var propertyAnalysis = analyzeProperties(variants, propertyNames);
  
  // Debug: Log complete variant analysis
  console.log("\n=== COMPLETE VARIANT ANALYSIS ===");
  console.log("Component Set Name:", componentSet.name);
  console.log("Total variants found:", variants.length);
  console.log("Properties found:", propertyNames);
  console.log("\n--- Individual Variants ---");
  variants.forEach(function(variant, index) {
    var dimensions = getComponentDimensions(variant.component);
    console.log("Variant " + index + ":");
    console.log("  Name:", variant.name);
    console.log("  Properties:", variant.properties);
    console.log("  Component size:", dimensions.width + "×" + dimensions.height + "px");
    console.log("  Original position:", variant.originalX + "," + variant.originalY);
  });
  console.log("\n--- Property Analysis ---");
  propertyAnalysis.forEach(function(prop) {
    console.log("Property '" + prop.name + "':");
    console.log("  Values:", prop.values);
    console.log("  Count:", prop.count);
    console.log("  Is Boolean:", prop.isBoolean);
  });
  
  // Calculate grid layout
  var gridLayout = calculateGridLayout(variants, propertyAnalysis);
  console.log("\n=== GRID LAYOUT ANALYSIS ===");
  console.log("Calculated grid size:", gridLayout.cols + "×" + gridLayout.rows, "=", gridLayout.cols * gridLayout.rows, "cells");
  console.log("Expected variants per cell:", variants.length / (gridLayout.cols * gridLayout.rows));
  console.log("\n--- Grid Properties ---");
  console.log("Primary property (columns):", gridLayout.primaryProp ? gridLayout.primaryProp.name : "none");
  if (gridLayout.primaryProp) {
    console.log("  Values:", gridLayout.primaryProp.values);
  }
  console.log("Secondary property (rows):", gridLayout.secondaryProp ? gridLayout.secondaryProp.name : "none");
  if (gridLayout.secondaryProp) {
    console.log("  Values:", gridLayout.secondaryProp.values);
  }
  console.log("Additional properties:", gridLayout.additionalProps ? gridLayout.additionalProps.map(function(p) { return p.name; }) : "none");
  
  console.log("\n=== VISUALIZATION SETTINGS ===");
  
  // Find largest component dimensions across all variants
  var largestWidth = 0;
  var largestHeight = 0;
  variants.forEach(function(variant) {
    var dimensions = getComponentDimensions(variant.component);
    if (dimensions.width > largestWidth) {
      largestWidth = dimensions.width;
    }
    if (dimensions.height > largestHeight) {
      largestHeight = dimensions.height;
    }
  });
  
  console.log("Layout Constants:");
  console.log("  CELL_PADDING:", CELL_PADDING + "px");
  console.log("  FRAME_PADDING:", FRAME_PADDING + "px");
  console.log("  LABEL_MARGIN:", LABEL_MARGIN + "px");
  console.log("\nDetected Component Sizes:");
  console.log("  LARGEST_COMPONENT_WIDTH:", largestWidth + "px");
  console.log("  LARGEST_COMPONENT_HEIGHT:", largestHeight + "px");
  console.log("  LARGEST_CELL_SIZE:", largestWidth + "×" + largestHeight + "px");
  console.log("\nColor Settings:");
  console.log("  FIGMA_PURPLE:", "#" + Math.round(FIGMA_PURPLE.r * 255).toString(16).padStart(2, '0') + Math.round(FIGMA_PURPLE.g * 255).toString(16).padStart(2, '0') + Math.round(FIGMA_PURPLE.b * 255).toString(16).padStart(2, '0'));
  
  console.log("\n=== CELL SIZING ANALYSIS ===");
  
  // Calculate max dimensions per row and column for non-uniform sizes
  var rowHeights = [];
  var colWidths = [];
  
  // Initialize arrays based on grid dimensions
  for (var i = 0; i < gridLayout.rows; i++) {
    rowHeights[i] = 0;
  }
  for (var i = 0; i < gridLayout.cols; i++) {
    colWidths[i] = 0;
  }
  
  console.log("Initialized grid arrays:", { rows: gridLayout.rows, cols: gridLayout.cols });
  
  // Find max dimensions for each row and column
  variants.forEach(function(variant) {
    var gridCol = 0;
    var gridRow = 0;
    
    if (gridLayout.primaryProp) {
      var primaryValue = variant.properties[gridLayout.primaryProp.name];
      gridCol = gridLayout.primaryProp.values.indexOf(primaryValue);
      if (gridCol === -1) {
        console.warn("Primary value not found:", primaryValue, "in", gridLayout.primaryProp.values);
        gridCol = 0;
      }
    }
    
    if (gridLayout.secondaryProp) {
      var secondaryValue = variant.properties[gridLayout.secondaryProp.name];
      gridRow = gridLayout.secondaryProp.values.indexOf(secondaryValue);
      if (gridRow === -1) {
        console.warn("Secondary value not found:", secondaryValue, "in", gridLayout.secondaryProp.values);
        gridRow = 0;
      }
    }
    
    if (!gridLayout.primaryProp) {
      gridCol = variants.indexOf(variant);
    }
    
    // Get component dimensions safely
    var dimensions = getComponentDimensions(variant.component);
    
    console.log("Variant", variant.name, "mapped to grid[", gridRow, "][", gridCol, "] - size:", dimensions.width + "x" + dimensions.height);
    
    // Update max dimensions
    if (dimensions.width > colWidths[gridCol]) {
      colWidths[gridCol] = dimensions.width;
    }
    if (dimensions.height > rowHeights[gridRow]) {
      rowHeights[gridRow] = dimensions.height;
    }
  });
  
  // Add padding to each cell - use adaptive padding for better efficiency
  var cellWidths = colWidths.map(function(w) { 
    // Use smaller padding for small components to avoid excessive white space
    var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, w * 0.8));
    return w + adaptivePadding; 
  });
  var cellHeights = rowHeights.map(function(h) { 
    var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, h * 0.8));
    return h + adaptivePadding; 
  });
  
  // Skip to clean implementation after line 1315 
  // (this is a temporary fix to bypass old code)
  if (true) {
    // Jump to the clean implementation
    return executeStep5_Clean(debugMode, existingData, variants, gridLayout);
  }
  
  // OLD CODE BELOW - TO BE REMOVED
  // Calculate total grid dimensions
  var totalGridWidth = cellWidths.reduce(function(sum, w) { return sum + w; }, 0);
  var totalGridHeight = cellHeights.reduce(function(sum, h) { return sum + h; }, 0);
  console.log("Raw column widths:", colWidths);
  console.log("Final column widths (with " + CELL_PADDING + "px padding):", cellWidths);
  console.log("Raw row heights:", rowHeights);
  console.log("Final row heights (with " + CELL_PADDING + "px padding):", cellHeights);
  console.log("\n--- Frame Calculations ---");
  console.log("Total grid content size:", totalGridWidth + "×" + totalGridHeight + "px");
  console.log("Final frame size (with " + FRAME_PADDING + "px border):", frameWidth + "×" + frameHeight + "px");
  console.log("Frame efficiency:", Math.round((totalGridWidth * totalGridHeight) / (frameWidth * frameHeight) * 100) + "% content");
  
  console.log("\n=== FRAME SIZING REASONING ===");
  console.log("Original component set:");
  console.log("  Size:", componentSet.width + "×" + componentSet.height + "px");
  console.log("  Position:", componentSet.x + "," + componentSet.y);
  console.log("\nCalculation steps:");
  console.log("1. Analyzed", variants.length, "variants in", gridLayout.cols + "×" + gridLayout.rows, "grid");
  console.log("2. Found max component sizes per row/column:");
  console.log("   - Column widths:", colWidths, "(raw component widths)");
  console.log("   - Row heights:", rowHeights, "(raw component heights)");
  console.log("3. Added adaptive padding (32-" + CELL_PADDING + "px based on component size) to each cell:");
  console.log("   - Padded column widths:", cellWidths);
  console.log("   - Padded row heights:", cellHeights);
  console.log("4. Calculated total grid content:");
  console.log("   - Width:", cellWidths.join(" + "), "=", totalGridWidth + "px");
  console.log("   - Height:", cellHeights.join(" + "), "=", totalGridHeight + "px");
  console.log("5. Added FRAME_PADDING (" + FRAME_PADDING + "px) on all sides:");
  console.log("   - Final width:", totalGridWidth, "+ 2×" + FRAME_PADDING, "=", frameWidth + "px");
  console.log("   - Final height:", totalGridHeight, "+ 2×" + FRAME_PADDING, "=", frameHeight + "px");
  console.log("\nSize change:");
  var widthChange = frameWidth - componentSet.width;
  var heightChange = frameHeight - componentSet.height;
  console.log("  Width:", componentSet.width + "px →", frameWidth + "px", "(" + (widthChange >= 0 ? "+" : "") + widthChange + "px)");
  console.log("  Height:", componentSet.height + "px →", frameHeight + "px", "(" + (heightChange >= 0 ? "+" : "") + heightChange + "px)");
  var areaChange = ((frameWidth * frameHeight) / (componentSet.width * componentSet.height) - 1) * 100;
  console.log("  Area change:", (areaChange >= 0 ? "+" : "") + Math.round(areaChange) + "%");
  
  // Calculate label spacing for positioning labels outside frame
  var labelSpaceLeft = (gridLayout.secondaryProp && gridLayout.rows > 1) ? LABEL_MARGIN : 0;
  var labelSpaceTop = (gridLayout.primaryProp && gridLayout.cols > 1) ? LABEL_MARGIN : 0;
  
  // Calculate total space needed including labels
  var totalWidth = frameWidth + labelSpaceLeft;
  var totalHeight = frameHeight + labelSpaceTop;
  
  console.log("\nTotal space requirements:");
  console.log("  Grid + frame:", frameWidth + "×" + frameHeight + "px");
  console.log("  Label margins:", labelSpaceLeft + "×" + labelSpaceTop + "px");
  console.log("  Total needed:", totalWidth + "×" + totalHeight + "px");
  console.log("  Current componentSet:", componentSet.width + "×" + componentSet.height + "px");
  
  // Resize component set to accommodate everything
  if (totalWidth !== componentSet.width || totalHeight !== componentSet.height) {
    console.log("Resizing componentSet to", totalWidth + "×" + totalHeight);
    componentSet.resize(totalWidth, totalHeight);
  } else {
    console.log("No componentSet resize needed");
  }
  
  // Create a wrapper frame for the variants only
  var docFrame = figma.createFrame();
  docFrame.name = componentSet.name + " - Documentation";
  docFrame.resize(frameWidth, frameHeight);
  docFrame.x = labelSpaceLeft;  // Position relative to componentSet
  docFrame.y = labelSpaceTop;   // Position relative to componentSet
  
  // Apply Figma default component set styling to wrapper
  docFrame.fills = []; // No fill
  docFrame.strokes = [{ type: "SOLID", color: FIGMA_PURPLE }];
  docFrame.strokeWeight = 1;
  docFrame.dashPattern = [6, 6];
  docFrame.cornerRadius = 5;
  docFrame.clipsContent = false;
  
  // Add wrapper frame to component set
  componentSet.appendChild(docFrame);
  
  // Move all component variants into the wrapper frame
  var variantComponents = componentSet.children.filter(function(child) {
    return child.type === "COMPONENT" && child !== docFrame;
  });
  
  variantComponents.forEach(function(variant) {
    docFrame.appendChild(variant);
  });
  
  // Remove original styling from component set (wrapper handles it now)
  componentSet.fills = [];
  componentSet.strokes = [];
  
  // Add inner grid lines within the frame
  var gridStartX = FRAME_PADDING;
  var gridStartY = FRAME_PADDING;
  
  // Vertical lines (created as horizontal lines then rotated)
  console.log("=== GRID LINES DEBUG ===");
  console.log("Creating vertical lines - cols:", gridLayout.cols, "cellWidths:", cellWidths);
  if (gridLayout.cols > 1) {
    var xPos = gridStartX;
    for (var col = 0; col < gridLayout.cols - 1; col++) {
      xPos += cellWidths[col];
      // Round to avoid half-pixel positioning
      var roundedXPos = Math.round(xPos);
      console.log("Creating vertical line", col, "at x:", roundedXPos, "(was", xPos + ")");
      var line = figma.createLine();
      // Create as horizontal line first
      line.resize(totalGridHeight, 0);
      // Rotate 90 degrees to make it vertical
      line.rotation = Math.PI / 2; // Use radians for precision
      // Position considering rotation (line rotates around its center)
      line.x = roundedXPos;
      line.y = gridStartY + Math.round(totalGridHeight / 2);
      line.strokes = [{ type: "SOLID", color: FIGMA_PURPLE }];
      line.strokeWeight = 1;
      line.dashPattern = [3, 3]; // Smaller dash pattern for inner lines
      line.opacity = 0.5; // Slightly transparent for subtlety
      line.name = "Grid Line Vertical " + col;
      docFrame.appendChild(line);
      console.log("Added vertical line:", line.name, "at position", line.x, line.y);
    }
  } else {
    console.log("No vertical lines needed - only", gridLayout.cols, "column(s)");
  }
  
  // Horizontal lines
  console.log("Creating horizontal lines - rows:", gridLayout.rows, "cellHeights:", cellHeights);
  if (gridLayout.rows > 1) {
    var yPos = gridStartY;
    for (var row = 0; row < gridLayout.rows - 1; row++) {
      yPos += cellHeights[row];
      // Round to avoid half-pixel positioning
      var roundedYPos = Math.round(yPos);
      console.log("Creating horizontal line", row, "at y:", roundedYPos, "(was", yPos + ")");
      var line = figma.createLine();
      // Create horizontal line with proper width
      line.resize(totalGridWidth, 0);
      // Position at center of line length
      line.x = gridStartX + Math.round(totalGridWidth / 2);
      line.y = roundedYPos;
      line.strokes = [{ type: "SOLID", color: FIGMA_PURPLE }];
      line.strokeWeight = 1;
      line.dashPattern = [3, 3]; // Smaller dash pattern for inner lines
      line.opacity = 0.5; // Slightly transparent for subtlety
      line.name = "Grid Line Horizontal " + row;
      docFrame.appendChild(line);
      console.log("Added horizontal line:", line.name, "at position", line.x, line.y);
    }
  } else {
    console.log("No horizontal lines needed - only", gridLayout.rows, "row(s)");
  }
  
  // Position variants within their cells
  console.log("\n=== VARIANT POSITIONING ===");
  variants.forEach(function(variant) {
    // Determine grid position based on primary and secondary properties
    var gridCol = 0;
    var gridRow = 0;
    
    if (gridLayout.primaryProp) {
      var primaryValue = variant.properties[gridLayout.primaryProp.name];
      gridCol = gridLayout.primaryProp.values.indexOf(primaryValue);
      if (gridCol === -1) gridCol = 0;
    }
    
    if (gridLayout.secondaryProp) {
      var secondaryValue = variant.properties[gridLayout.secondaryProp.name];
      gridRow = gridLayout.secondaryProp.values.indexOf(secondaryValue);
      if (gridRow === -1) gridRow = 0;
    }
    
    // Handle single property case - arrange horizontally
    if (!gridLayout.primaryProp) {
      gridCol = variants.indexOf(variant);
    }
    
    // Calculate cell position within the grid
    var cellX = FRAME_PADDING;
    for (var c = 0; c < gridCol; c++) {
      cellX += cellWidths[c];
    }
    
    var cellY = FRAME_PADDING;
    for (var r = 0; r < gridRow; r++) {
      cellY += cellHeights[r];
    }
    
    // Get component dimensions safely
    var dimensions = getComponentDimensions(variant.component);
    
    // Center variant within its cell
    var cellWidth = cellWidths[gridCol];
    var cellHeight = cellHeights[gridRow];
    var variantX = Math.round(cellX + (cellWidth - dimensions.width) / 2);
    var variantY = Math.round(cellY + (cellHeight - dimensions.height) / 2);
    
    // Position the variant component
    variant.component.x = variantX;
    variant.component.y = variantY;
    
    console.log("Positioned", variant.name, "at cell[", gridRow, "][", gridCol, "] - coords:", variantX + "," + variantY);
    console.log("  Cell bounds:", cellX + "," + cellY, "size:", cellWidth + "×" + cellHeight);
    console.log("  Component size:", dimensions.width + "×" + dimensions.height);
  });
  
  // Position labels outside the wrapper frame in the parent
  var parentFrame = docFrame.parent;
  
  if (gridLayout.primaryProp && gridLayout.cols > 1) {
    // Column headers (property values) - positioned above the frame, centered in each column
    // But leftmost column header should align with leftmost edge of row labels
    var leftmostRowLabelX = docFrame.x; // Default if no row labels
    
    if (gridLayout.secondaryProp && gridLayout.rows > 1) {
      // Calculate the leftmost position where row labels will appear
      var maxRowLabelWidth = 0;
      gridLayout.secondaryProp.values.forEach(function(value) {
        var tempLabel = figma.createText();
        try {
          tempLabel.fontName = { family: "Inter", style: "Regular" };
        } catch (error) {
          // Use default font
        }
        tempLabel.characters = value;
        tempLabel.fontSize = 12;
        var labelWidth = tempLabel.width;
        if (labelWidth > maxRowLabelWidth) {
          maxRowLabelWidth = labelWidth;
        }
        tempLabel.remove(); // Clean up temp label
      });
      
      leftmostRowLabelX = docFrame.x - 8 - maxRowLabelWidth;
      console.log("Row labels leftmost position calculated as:", leftmostRowLabelX, "(widest label:", maxRowLabelWidth + "px)");
    }
    
    var xPos = docFrame.x + gridStartX; // Start at first column position
    for (var col = 0; col < gridLayout.cols; col++) {
      var label = figma.createText();
      try {
        label.fontName = { family: "Inter", style: "Regular" };
      } catch (error) {
        console.log("Using default font for column label");
      }
      label.characters = gridLayout.primaryProp.values[col];
      label.fontSize = 12;
      label.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
      label.textAlignHorizontal = "CENTER";
      
      // Center the label in the column, but for first column align left edge with row labels
      var labelX = xPos + (cellWidths[col] / 2) - (label.width / 2);
      
      // For the first column, extend leftward to align with row label leftmost position
      if (col === 0 && gridLayout.secondaryProp && gridLayout.rows > 1) {
        labelX = Math.min(labelX, leftmostRowLabelX);
        console.log("First column header aligned to row label position:", labelX);
      }
      
      var labelY = docFrame.y - 20; // Above the frame
      label.x = labelX;
      label.y = labelY;
      label.name = "Column Label " + col;
      
      parentFrame.appendChild(label);
      xPos += cellWidths[col];
    }
    
    // Property name label (top center) - centered over entire grid width
    var propertyLabel = figma.createText();
    try {
      propertyLabel.fontName = { family: "Inter", style: "Medium" };
    } catch (error) {
      console.log("Using default font for property label");
    }
    propertyLabel.characters = gridLayout.primaryProp.name;
    propertyLabel.fontSize = 12;
    propertyLabel.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
    propertyLabel.textAlignHorizontal = "CENTER";
    
    // Center over the entire grid width
    var gridCenterX = docFrame.x + (frameWidth / 2);
    propertyLabel.x = gridCenterX - (propertyLabel.width / 2);
    propertyLabel.y = docFrame.y - 40; // Above column labels
    propertyLabel.name = "Property Label Primary";
    parentFrame.appendChild(propertyLabel);
  }
  
  if (gridLayout.secondaryProp && gridLayout.rows > 1) {
    // Row headers (property values) - positioned to the left of the frame, centered in each row
    var yPos = docFrame.y + gridStartY;
    for (var row = 0; row < gridLayout.rows; row++) {
      var label = figma.createText();
      try {
        label.fontName = { family: "Inter", style: "Regular" };
      } catch (error) {
        console.log("Using default font for row label");
      }
      label.characters = gridLayout.secondaryProp.values[row];
      label.fontSize = 12;
      label.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
      label.textAlignHorizontal = "RIGHT";
      
      var labelX = docFrame.x - 8 - label.width; // To the left of frame
      // Center the label in the row
      var labelY = yPos + (cellHeights[row] / 2) - (label.height / 2);
      label.x = labelX;
      label.y = labelY;
      label.name = "Row Label " + row;
      
      parentFrame.appendChild(label);
      yPos += cellHeights[row];
    }
    
    // Property name label (left center, rotated) - centered over entire grid height
    var propertyLabel = figma.createText();
    try {
      propertyLabel.fontName = { family: "Inter", style: "Medium" };
    } catch (error) {
      console.log("Using default font for property label");
    }
    propertyLabel.characters = gridLayout.secondaryProp.name;
    propertyLabel.fontSize = 12;
    propertyLabel.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
    propertyLabel.rotation = -90;
    
    // Center over the entire grid height
    var gridCenterY = docFrame.y + (frameHeight / 2);
    propertyLabel.x = docFrame.x - 30; // Further left
    propertyLabel.y = gridCenterY + (propertyLabel.width / 2); // Adjust for rotation
    propertyLabel.name = "Property Label Secondary";
    parentFrame.appendChild(propertyLabel);
  }
  
  // Group variants by grid position for multiple variants per cell
  var variantsByCell = new Map();
  
  variants.forEach(function(variant) {
    // Determine grid position based on primary and secondary properties
    var gridCol = 0;
    var gridRow = 0;
    
    if (gridLayout.primaryProp) {
      var primaryValue = variant.properties[gridLayout.primaryProp.name];
      gridCol = gridLayout.primaryProp.values.indexOf(primaryValue);
      if (gridCol === -1) gridCol = 0;
    }
    
    if (gridLayout.secondaryProp) {
      var secondaryValue = variant.properties[gridLayout.secondaryProp.name];
      gridRow = gridLayout.secondaryProp.values.indexOf(secondaryValue);
      if (gridRow === -1) gridRow = 0;
    }
    
    // For single property or no properties, just use index
    if (!gridLayout.primaryProp) {
      gridCol = variants.indexOf(variant);
    }
    
    var cellKey = gridRow + "_" + gridCol;
    if (!variantsByCell.has(cellKey)) {
      variantsByCell.set(cellKey, []);
    }
    variantsByCell.get(cellKey).push({ variant: variant, gridCol: gridCol, gridRow: gridRow });
  });
  
  console.log("\n=== VARIANT PLACEMENT ANALYSIS ===");
  console.log("Variants grouped by cell position:");
  variantsByCell.forEach(function(cellVariants, cellKey) {
    var gridRow = parseInt(cellKey.split("_")[0]);
    var gridCol = parseInt(cellKey.split("_")[1]);
    console.log("Cell [" + gridRow + "][" + gridCol + "] contains", cellVariants.length, "variant(s):");
    cellVariants.forEach(function(variantInfo) {
      console.log("  - " + variantInfo.variant.name + " (" + JSON.stringify(variantInfo.variant.properties) + ")");
    });
  });
  
  // Position variants within their cells
  variantsByCell.forEach(function(cellVariants, cellKey) {
    var gridRow = parseInt(cellKey.split("_")[0]);
    var gridCol = parseInt(cellKey.split("_")[1]);
    
    // Calculate base cell position
    var cellX = gridStartX;
    for (var i = 0; i < gridCol; i++) {
      cellX += cellWidths[i];
    }
    
    var cellY = gridStartY;
    for (var i = 0; i < gridRow; i++) {
      cellY += cellHeights[i];
    }
    
    // If multiple variants in same cell, arrange them horizontally
    var variantCount = cellVariants.length;
    var variantSpacing = variantCount > 1 ? (cellWidths[gridCol] - CELL_PADDING) / variantCount : cellWidths[gridCol];
    
    cellVariants.forEach(function(variantInfo, index) {
      var variant = variantInfo.variant;
      
      var dimensions = getComponentDimensions(variant.component);
      var x, y;
      if (variantCount === 1) {
        // Single variant - center in cell
        x = cellX + (cellWidths[gridCol] - dimensions.width) / 2;
        y = cellY + (cellHeights[gridRow] - dimensions.height) / 2;
      } else {
        // Multiple variants - arrange horizontally with spacing
        x = cellX + (index * variantSpacing) + (variantSpacing - dimensions.width) / 2;
        y = cellY + (cellHeights[gridRow] - dimensions.height) / 2;
      }
      
      // Move the variant to its new position
      variant.component.x = x;
      variant.component.y = y;
      
      console.log("Positioned variant", variant.name, "at", x, y, "in cell", gridRow, gridCol);
    });
  });
  
  // Move all grid lines to the back (behind variants)
  componentSet.children.forEach(function(child) {
    if (child.type === "LINE" && child.name.includes("Grid Line")) {
      componentSet.insertChild(0, child);
    }
  });
  
  // Select the reorganized component set
  figma.currentPage.selection = [componentSet];
  figma.viewport.scrollAndZoomIntoView([componentSet]);
  
  figma.notify("Reorganized " + variants.length + " variants into uniform grid");
  figma.closePlugin();
}

function createDebugDump(componentSet, variantData) {
  console.log("\n\n=== COMPONENT SET DEBUG DUMP ===");
  console.log("Copy this data for test case creation:\n");
  
  var debugData = {
    componentSetName: componentSet.name,
    componentSetSize: {
      width: componentSet.width,
      height: componentSet.height
    },
    componentSetPosition: {
      x: componentSet.x,
      y: componentSet.y
    },
    totalVariants: variantData.variants.length,
    properties: variantData.propertyNames,
    variants: variantData.variants.map(function(variant) {
      var dimensions = getComponentDimensions(variant.component);
      return {
        name: variant.name,
        properties: variant.properties,
        size: {
          width: dimensions.width,
          height: dimensions.height
        },
        originalPosition: {
          x: variant.originalX,
          y: variant.originalY
        },
        isDefault: variant.isDefault
      };
    })
  };
  
  console.log("DEBUG_DATA = ", JSON.stringify(debugData, null, 2));
  
  // Also create a readable summary
  console.log("\n--- READABLE SUMMARY ---");
  console.log("Component:", debugData.componentSetName);
  console.log("Properties:", debugData.properties.join(", "));
  console.log("Variants (", debugData.totalVariants, "):");
  
  debugData.variants.forEach(function(variant, index) {
    var propsList = Object.keys(variant.properties).map(function(key) {
      return key + "=" + variant.properties[key];
    }).join(", ");
    
    console.log("  " + (index + 1) + ". " + variant.name);
    console.log("     Properties: " + propsList);
    console.log("     Size: " + variant.size.width + "×" + variant.size.height + "px");
    console.log("     Position: (" + variant.originalPosition.x + ", " + variant.originalPosition.y + ")");
    if (variant.isDefault) console.log("     *** DEFAULT VARIANT ***");
    console.log("");
  });
  
  console.log("\n=== END DEBUG DUMP ===\n\n");
}

// Individual step execution functions for UI
async function executeStep1_ValidationSelection(debugMode) {
  if (debugMode) console.log("=== STEP 1: Selection Validation ===");
  
  if (figma.currentPage.selection.length === 0) {
    throw new Error("No selection found. Please select a component set.");
  }
  
  if (figma.currentPage.selection.length > 1) {
    throw new Error("Multiple items selected. Please select only one component set.");
  }
  
  var selection = figma.currentPage.selection[0];
  
  if (selection.type !== "COMPONENT_SET") {
    throw new Error("Selected item is " + selection.type + ", not COMPONENT_SET. Please select a component set with variants.");
  }
  
  var componentSet = selection;
  var childComponents = componentSet.children.filter(function(child) { return child.type === "COMPONENT"; });
  
  if (childComponents.length === 0) {
    throw new Error("Component set contains no variant components.");
  }
  
  if (debugMode) {
    console.log("Selection validated:");
    console.log("  Name: " + componentSet.name);
    console.log("  Type: " + componentSet.type);
    console.log("  Dimensions: " + componentSet.width + "×" + componentSet.height + "px");
    console.log("  Position: " + componentSet.x + ", " + componentSet.y);
    console.log("  Variant count: " + childComponents.length);
  }
  
  return {
    componentSet: {
      name: componentSet.name,
      width: componentSet.width,
      height: componentSet.height,
      x: componentSet.x,
      y: componentSet.y
    },
    variantCount: childComponents.length
  };
}

async function executeStep2_ExtractVariants(debugMode, existingData) {
  if (debugMode) console.log("=== STEP 2: Variant Extraction ===");
  
  var selection = figma.currentPage.selection[0];
  if (debugMode) console.log("Selection:", selection.name, selection.type);
  
  var componentSet = selection;
  if (debugMode) console.log("Component set children count:", componentSet.children.length);
  
  if (debugMode) console.log("Calling extractVariantData...");
  var variantData = extractVariantData(componentSet);
  if (debugMode) console.log("Received variant data:", variantData);
  
  if (!variantData || !variantData.variants) {
    throw new Error("extractVariantData returned invalid data: " + JSON.stringify(variantData));
  }
  
  var variants = variantData.variants;
  
  if (debugMode) {
    console.log("Extracted " + variants.length + " variants:");
    variants.forEach(function(variant, index) {
      var dimensions = getComponentDimensions(variant.component);
      console.log("  " + (index + 1) + ". " + variant.name);
      console.log("     Size: " + dimensions.width + "×" + dimensions.height + "px");
      console.log("     Properties:", variant.properties);
    });
  }
  
  return { 
    variants: variants,
    propertyNames: variantData.propertyNames 
  };
}

async function executeStep3_AnalyzeProperties(debugMode, existingData) {
  if (debugMode) console.log("=== STEP 3: Property Analysis ===");
  
  if (!existingData.variants) {
    throw new Error("No variants available. Run Step 2 first.");
  }
  
  // Step 3: Analyze properties independently using accumulated data
  var variants = existingData.variants;
  var propertyNames = existingData.propertyNames || [];
  
  if (debugMode) {
    console.log("Analyzing", variants.length, "variants");
    console.log("Property names:", propertyNames);
  }
  
  // Build property analysis from scratch for this step
  var propertyAnalysis = [];
  
  propertyNames.forEach(function(propName) {
    // Get unique values for this property
    var values = [];
    variants.forEach(function(variant) {
      var value = variant.properties[propName];
      if (values.indexOf(value) === -1) {
        values.push(value);
      }
    });
    values.sort();
    
    // Check if it's a boolean property
    var isBoolean = values.length === 2 && 
      (values.indexOf("True") !== -1 && values.indexOf("False") !== -1 ||
       values.indexOf("true") !== -1 && values.indexOf("false") !== -1 ||
       values.indexOf("On") !== -1 && values.indexOf("Off") !== -1 ||
       values.indexOf("on") !== -1 && values.indexOf("off") !== -1);
    
    propertyAnalysis.push({
      name: propName,
      values: values,
      count: values.length,
      isBoolean: isBoolean
    });
  });
  
  // Sort properties: non-boolean first, then by count (descending)
  propertyAnalysis.sort(function(a, b) {
    if (a.isBoolean && !b.isBoolean) return 1;
    if (!a.isBoolean && b.isBoolean) return -1;
    return b.count - a.count;
  });
  
  if (debugMode) {
    console.log("Property analysis:");
    propertyAnalysis.forEach(function(prop) {
      console.log("  " + prop.name + ": [" + prop.values.join(', ') + "] (" + (prop.isBoolean ? 'Boolean' : 'Multi-value') + ")");
    });
  }
  
  return { properties: propertyAnalysis };
}

async function executeStep4_CalculateGrid(debugMode, existingData) {
  if (debugMode) console.log("=== STEP 4: Grid Layout Calculation ===");
  
  if (!existingData.variants || !existingData.properties) {
    throw new Error("Missing data. Run Steps 2 and 3 first.");
  }
  
  // Step 4: Calculate grid layout independently using accumulated data
  var variants = existingData.variants;
  var propertyAnalysis = existingData.properties;
  
  if (debugMode) {
    console.log("Calculating grid for", variants.length, "variants");
    console.log("Using", propertyAnalysis.length, "analyzed properties");
  }
  
  // Calculate grid layout from scratch for this step
  var gridLayout;
  
  if (propertyAnalysis.length === 0) {
    // No properties - single row
    gridLayout = {
      cols: variants.length,
      rows: 1,
      primaryProp: null,
      secondaryProp: null
    };
  } else if (propertyAnalysis.length === 1) {
    // Single property - single row
    var prop = propertyAnalysis[0];
    gridLayout = {
      cols: prop.count,
      rows: 1,
      primaryProp: prop,
      secondaryProp: null
    };
  } else {
    // Two or more properties - use first two for grid
    var primaryProp = propertyAnalysis[0];
    var secondaryProp = propertyAnalysis[1];
    
    gridLayout = {
      cols: primaryProp.count,
      rows: secondaryProp.count,
      primaryProp: primaryProp,
      secondaryProp: secondaryProp,
      additionalProps: propertyAnalysis.slice(2)
    };
  }
  
  if (debugMode) {
    console.log("Grid layout calculated:");
    console.log("  Dimensions: " + gridLayout.cols + "×" + gridLayout.rows);
    console.log("  Primary property (columns): " + (gridLayout.primaryProp ? gridLayout.primaryProp.name : 'none'));
    console.log("  Secondary property (rows): " + (gridLayout.secondaryProp ? gridLayout.secondaryProp.name : 'none'));
  }
  
  return { gridLayout: gridLayout };
}

// Clean implementation of Step 5
async function executeStep5_Clean(debugMode, existingData, variants, gridLayout) {
  var selection = figma.currentPage.selection[0];
  var componentSet = selection;
  var CELL_PADDING = 32;
  var FIGMA_PURPLE = { r: 0.588, g: 0.278, b: 1 };

  // Calculate actual bounds of all variants FIRST
  var minX = Math.min.apply(Math, variants.map(function(v) { return v.originalX; }));
  var minY = Math.min.apply(Math, variants.map(function(v) { return v.originalY; }));
  var maxX = Math.max.apply(Math, variants.map(function(v) { 
    var dimensions = getComponentDimensions(v.component);
    return v.originalX + dimensions.width; 
  }));
  var maxY = Math.max.apply(Math, variants.map(function(v) { 
    var dimensions = getComponentDimensions(v.component);
    return v.originalY + dimensions.height; 
  }));
  
  if (debugMode) {
    console.log("Original variant bounds:", minX + "," + minY, "to", maxX + "," + maxY);
    console.log("Original bounds size:", (maxX - minX) + "×" + (maxY - minY));
  }

  // Calculate cell dimensions based on actual component sizes
  var rowHeights = [];
  var colWidths = [];
  
  // Initialize arrays
  for (var i = 0; i < gridLayout.rows; i++) {
    rowHeights[i] = 0;
  }
  for (var i = 0; i < gridLayout.cols; i++) {
    colWidths[i] = 0;
  }
  
  // Find max dimensions for each row and column
  variants.forEach(function(variant) {
    var gridCol = 0;
    var gridRow = 0;
    
    if (gridLayout.primaryProp) {
      var primaryValue = variant.properties[gridLayout.primaryProp.name];
      gridCol = gridLayout.primaryProp.values.indexOf(primaryValue);
      if (gridCol === -1) gridCol = 0;
    }
    
    if (gridLayout.secondaryProp) {
      var secondaryValue = variant.properties[gridLayout.secondaryProp.name];
      gridRow = gridLayout.secondaryProp.values.indexOf(secondaryValue);
      if (gridRow === -1) gridRow = 0;
    }
    
    if (!gridLayout.primaryProp) {
      gridCol = variants.indexOf(variant);
    }
    
    // Get component dimensions safely
    var dimensions = getComponentDimensions(variant.component);
    
    // Update max dimensions
    if (dimensions.width > colWidths[gridCol]) {
      colWidths[gridCol] = dimensions.width;
    }
    if (dimensions.height > rowHeights[gridRow]) {
      rowHeights[gridRow] = dimensions.height;
    }
  });
  
  // Add adaptive padding to each cell
  var cellWidths = colWidths.map(function(w) {
    var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, w * 0.8));
    return w + adaptivePadding;
  });
  var cellHeights = rowHeights.map(function(h) {
    var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, h * 0.8));
    return h + adaptivePadding;
  });
  
  // Calculate grid dimensions
  var totalGridWidth = cellWidths.reduce(function(sum, w) { return sum + w; }, 0);
  var totalGridHeight = cellHeights.reduce(function(sum, h) { return sum + h; }, 0);
  
  // Component set should be resized to grid size
  var componentSetWidth = totalGridWidth;
  var componentSetHeight = totalGridHeight;
  var wrapperFrameWidth = totalGridWidth;
  var wrapperFrameHeight = totalGridHeight;
  
  if (debugMode) {
    console.log("Cell sizes - widths:", cellWidths, "heights:", cellHeights);
    console.log("Grid total size:", totalGridWidth + "×" + totalGridHeight);
    console.log("\n=== RESIZE DEBUG ===");
    console.log("Current component set size:", componentSet.width + "×" + componentSet.height);
    console.log("Target component set size:", componentSetWidth + "×" + componentSetHeight);
    console.log("Width difference:", componentSetWidth - componentSet.width);
    console.log("Height difference:", componentSetHeight - componentSet.height);
    console.log("Need to resize component set?", componentSetWidth !== componentSet.width || componentSetHeight !== componentSet.height);
  }
  
  // ACTUALLY RESIZE THE COMPONENT SET (to fit just the grid, not including labels)
  if (componentSetWidth !== componentSet.width || componentSetHeight !== componentSet.height) {
    if (debugMode) {
      console.log("Resizing component set from", componentSet.width + "×" + componentSet.height, "to", componentSetWidth + "×" + componentSetHeight);
    }
    
    try {
      componentSet.resize(componentSetWidth, componentSetHeight);
      if (debugMode) {
        console.log("Resize successful! New size:", componentSet.width + "×" + componentSet.height);
        console.log("Resize matches target?", componentSet.width === componentSetWidth && componentSet.height === componentSetHeight);
      }
    } catch (error) {
      console.error("Error during resize:", error);
      if (debugMode) {
        console.log("Resize failed. Component set remains:", componentSet.width + "×" + componentSet.height);
      }
    }
  } else {
    if (debugMode) {
      console.log("No resize needed - component set dimensions already match");
    }
  }
  
  // ACTUALLY CREATE THE WRAPPER FRAME IN THE PARENT
  var parentNode = componentSet.parent;
  var docFrame = figma.createFrame();
  docFrame.name = componentSet.name + " - Documentation";
  
  // Position the wrapper frame at the actual top-left of variant content
  docFrame.x = minX;
  docFrame.y = minY;
  docFrame.resize(wrapperFrameWidth, wrapperFrameHeight);
  
  // Apply purple styling to the wrapper Documentation frame (this is what users see)
  docFrame.fills = [];
  docFrame.strokes = [{ type: "SOLID", color: FIGMA_PURPLE }];
  docFrame.strokeWeight = 1;
  docFrame.dashPattern = [6, 6];
  docFrame.cornerRadius = 5;
  
  // Add wrapper frame to parent
  parentNode.appendChild(docFrame);
  
  // Move the entire component set into the wrapper frame
  docFrame.appendChild(componentSet);
  
  // Position component set at 0,0 RELATIVE TO THE WRAPPER FRAME
  // When appendChild() moves a node to a new parent, coordinates become relative to that parent
  // So we need to account for the wrapper frame's position
  componentSet.x = 0;  // This should now be relative to docFrame
  componentSet.y = 0;  // This should now be relative to docFrame
  // Component set was already resized earlier, no need to resize again
  
  if (debugMode) {
    console.log("Component set positioned at (0,0) within wrapper");
    console.log("Component set current size:", componentSet.width + "×" + componentSet.height);
  }
  
  // Remove ALL styling from component set - it should be invisible container for variants
  componentSet.fills = [];
  componentSet.strokes = [];  // Remove original border completely
  
  // Position variants within their cells
  variants.forEach(function(variant) {
    // Determine grid position based on properties  
    var gridCol = 0;
    var gridRow = 0;
    
    if (gridLayout.primaryProp) {
      var primaryValue = variant.properties[gridLayout.primaryProp.name];
      gridCol = gridLayout.primaryProp.values.indexOf(primaryValue);
      if (gridCol === -1) gridCol = 0;
    }
    
    if (gridLayout.secondaryProp) {
      var secondaryValue = variant.properties[gridLayout.secondaryProp.name];
      gridRow = gridLayout.secondaryProp.values.indexOf(secondaryValue);
      if (gridRow === -1) gridRow = 0;
    }
    
    if (!gridLayout.primaryProp) {
      gridCol = variants.indexOf(variant);
    }
    
    // Calculate cell position within the grid
    var cellX = 0;
    for (var c = 0; c < gridCol; c++) {
      cellX += cellWidths[c];
    }
    
    var cellY = 0;
    for (var r = 0; r < gridRow; r++) {
      cellY += cellHeights[r];
    }
    
    // Get component dimensions safely
    var dimensions = getComponentDimensions(variant.component);
    
    // Center variant within its cell
    var cellWidth = cellWidths[gridCol];
    var cellHeight = cellHeights[gridRow];
    var variantX = Math.round(cellX + (cellWidth - dimensions.width) / 2);
    var variantY = Math.round(cellY + (cellHeight - dimensions.height) / 2);
    
    // Position the variant component
    variant.component.x = variantX;
    variant.component.y = variantY;
    
    if (debugMode) {
      console.log("Positioned", variant.name, "at cell[", gridRow, "][", gridCol, "] - coords:", variantX + "," + variantY);
      console.log("  Cell bounds:", cellX + "," + cellY, "size:", cellWidth + "×" + cellHeight);
      console.log("  Component size:", dimensions.width + "×" + dimensions.height);
    }
  });
  
  if (debugMode) {
    console.log("Created wrapper frame:", docFrame.name);
    console.log("Moved component set into wrapper frame");
    console.log("Wrapper frame size:", docFrame.width + "×" + docFrame.height);
    console.log("Component set size:", componentSet.width + "×" + componentSet.height);
    console.log("Architecture: WrapperFrame > ComponentSet > Variants");
  }
  
  return {
    frameSetup: {
      frameWidth: wrapperFrameWidth,
      frameHeight: wrapperFrameHeight,
      cellWidths: cellWidths,
      cellHeights: cellHeights,
      docFrame: docFrame,
      componentSet: componentSet
    }
  };
}

// OLD FUNCTION REMOVED - Using executeStep5_Clean instead

async function executeStep6_CreateGridLines(debugMode, existingData) {
  if (debugMode) console.log("=== STEP 6: Grid Lines Creation ===");
  
  if (!existingData.gridLayout || !existingData.frameSetup) {
    throw new Error("Missing data. Run Steps 2, 3, 4, and 5 first.");
  }
  
  // Get the current selection and find the wrapper frame
  var selection = figma.currentPage.selection[0];
  if (!selection || selection.type !== "COMPONENT_SET") {
    throw new Error("Please select the component set");
  }
  
  var componentSet = selection;
  var wrapperFrame = componentSet.parent;
  
  if (!wrapperFrame || wrapperFrame.name.indexOf("Documentation") === -1) {
    throw new Error("Wrapper frame not found. Run Step 5 first.");
  }
  
  // Step 6: Actually create grid lines in the wrapper frame
  var gridLayout = existingData.gridLayout;
  var frameSetup = existingData.frameSetup;
  var FIGMA_PURPLE = { r: 0.588, g: 0.278, b: 1 };
  
  if (debugMode) {
    console.log("Creating grid lines for", gridLayout.cols + "×" + gridLayout.rows, "grid");
    console.log("Wrapper frame size:", wrapperFrame.width + "×" + wrapperFrame.height);
  }
  
  // Re-extract variant data to get actual component dimensions for cell calculations
  var variantData = extractVariantData(componentSet);
  var variants = variantData.variants;
  
  // Calculate cell dimensions (same logic as Step 5)
  var rowHeights = [];
  var colWidths = [];
  var CELL_PADDING = 32;
  
  // Initialize arrays
  for (var i = 0; i < gridLayout.rows; i++) {
    rowHeights[i] = 0;
  }
  for (var i = 0; i < gridLayout.cols; i++) {
    colWidths[i] = 0;
  }
  
  // Find max dimensions for each row and column
  variants.forEach(function(variant) {
    var gridCol = 0;
    var gridRow = 0;
    
    if (gridLayout.primaryProp) {
      var primaryValue = variant.properties[gridLayout.primaryProp.name];
      gridCol = gridLayout.primaryProp.values.indexOf(primaryValue);
      if (gridCol === -1) gridCol = 0;
    }
    
    if (gridLayout.secondaryProp) {
      var secondaryValue = variant.properties[gridLayout.secondaryProp.name];
      gridRow = gridLayout.secondaryProp.values.indexOf(secondaryValue);
      if (gridRow === -1) gridRow = 0;
    }
    
    if (!gridLayout.primaryProp) {
      gridCol = variants.indexOf(variant);
    }
    
    // Get component dimensions safely
    var dimensions = getComponentDimensions(variant.component);
    
    // Update max dimensions
    if (dimensions.width > colWidths[gridCol]) {
      colWidths[gridCol] = dimensions.width;
    }
    if (dimensions.height > rowHeights[gridRow]) {
      rowHeights[gridRow] = dimensions.height;
    }
  });
  
  // Add adaptive padding to each cell
  var cellWidths = colWidths.map(function(w) {
    var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, w * 0.8));
    return w + adaptivePadding;
  });
  var cellHeights = rowHeights.map(function(h) {
    var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, h * 0.8));
    return h + adaptivePadding;
  });
  
  var gridLinesCreated = 0;
  
  // Create vertical grid lines (between columns)
  if (gridLayout.cols > 1) {
    var currentX = 0;
    for (var col = 0; col < gridLayout.cols - 1; col++) {
      currentX += cellWidths[col];
      
      // Create vertical line using a thin rectangle
      var vLine = figma.createRectangle();
      vLine.name = "Grid Line V" + (col + 1);
      
      // Position line
      var totalHeight = cellHeights.reduce(function(sum, h) { return sum + h; }, 0);
      
      // Make it a thin vertical rectangle (1px wide, full height)
      vLine.resize(1, totalHeight);
      
      // Position the line
      vLine.x = currentX;
      vLine.y = 0;
      
      // Style the line to look like a dashed line
      vLine.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
      vLine.opacity = 0.5;
      
      // Add to wrapper frame
      wrapperFrame.appendChild(vLine);
      gridLinesCreated++;
      
      if (debugMode) {
        console.log("Created vertical grid line at x=" + currentX);
      }
    }
  }
  
  // Create horizontal grid lines (between rows)
  if (gridLayout.rows > 1) {
    var currentY = 0;
    for (var row = 0; row < gridLayout.rows - 1; row++) {
      currentY += cellHeights[row];
      
      // Create horizontal line using a thin rectangle
      var hLine = figma.createRectangle();
      hLine.name = "Grid Line H" + (row + 1);
      
      // Position line
      var totalWidth = cellWidths.reduce(function(sum, w) { return sum + w; }, 0);
      
      // Make it a thin horizontal rectangle (full width, 1px tall)
      hLine.resize(totalWidth, 1);
      hLine.x = 0;
      hLine.y = currentY;
      
      // Style the line to look like a dashed line
      hLine.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
      hLine.opacity = 0.5;
      
      // Add to wrapper frame
      wrapperFrame.appendChild(hLine);
      gridLinesCreated++;
      
      if (debugMode) {
        console.log("Created horizontal grid line at y=" + currentY);
      }
    }
  }
  
  if (debugMode) {
    console.log("Created", gridLinesCreated, "grid lines total");
  }
  
  return { 
    gridLinesCreated: gridLinesCreated,
    verticalLines: gridLayout.cols > 1 ? gridLayout.cols - 1 : 0,
    horizontalLines: gridLayout.rows > 1 ? gridLayout.rows - 1 : 0
  };
}

async function executeStep7_PositionVariants(debugMode, existingData) {
  if (debugMode) console.log("=== STEP 7: Variant Positioning ===");
  
  if (!existingData.gridLayout) {
    throw new Error("Missing data. Run Steps 2, 3, and 4 first.");
  }
  
  // Get the current selection and components
  var selection = figma.currentPage.selection[0];
  if (!selection || selection.type !== "COMPONENT_SET") {
    throw new Error("Please select the component set");
  }
  
  var componentSet = selection;
  var wrapperFrame = componentSet.parent;
  
  if (!wrapperFrame || wrapperFrame.name.indexOf("Documentation") === -1) {
    throw new Error("Wrapper frame not found. Run Step 5 first.");
  }
  
  // Re-extract variant data to get actual component objects
  var variantData = extractVariantData(componentSet);
  var variants = variantData.variants;
  var gridLayout = existingData.gridLayout;
  var CELL_PADDING = 32;
  
  if (debugMode) {
    console.log("Positioning", variants.length, "variants in", gridLayout.cols + "×" + gridLayout.rows, "grid");
  }
  
  // Calculate cell dimensions (same logic as previous steps)
  var rowHeights = [];
  var colWidths = [];
  
  // Initialize arrays
  for (var i = 0; i < gridLayout.rows; i++) {
    rowHeights[i] = 0;
  }
  for (var i = 0; i < gridLayout.cols; i++) {
    colWidths[i] = 0;
  }
  
  // Find max dimensions for each row and column
  variants.forEach(function(variant) {
    var gridCol = 0;
    var gridRow = 0;
    
    if (gridLayout.primaryProp) {
      var primaryValue = variant.properties[gridLayout.primaryProp.name];
      gridCol = gridLayout.primaryProp.values.indexOf(primaryValue);
      if (gridCol === -1) gridCol = 0;
    }
    
    if (gridLayout.secondaryProp) {
      var secondaryValue = variant.properties[gridLayout.secondaryProp.name];
      gridRow = gridLayout.secondaryProp.values.indexOf(secondaryValue);
      if (gridRow === -1) gridRow = 0;
    }
    
    if (!gridLayout.primaryProp) {
      gridCol = variants.indexOf(variant);
    }
    
    // Get component dimensions safely
    var dimensions = getComponentDimensions(variant.component);
    
    // Update max dimensions
    if (dimensions.width > colWidths[gridCol]) {
      colWidths[gridCol] = dimensions.width;
    }
    if (dimensions.height > rowHeights[gridRow]) {
      rowHeights[gridRow] = dimensions.height;
    }
  });
  
  // Add adaptive padding to each cell
  var cellWidths = colWidths.map(function(w) {
    var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, w * 0.8));
    return w + adaptivePadding;
  });
  var cellHeights = rowHeights.map(function(h) {
    var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, h * 0.8));
    return h + adaptivePadding;
  });
  
  var variantsPositioned = 0;
  
  // Actually position each variant
  variants.forEach(function(variant) {
    // Determine grid position based on properties
    var gridCol = 0;
    var gridRow = 0;
    
    if (gridLayout.primaryProp) {
      var primaryValue = variant.properties[gridLayout.primaryProp.name];
      gridCol = gridLayout.primaryProp.values.indexOf(primaryValue);
      if (gridCol === -1) gridCol = 0;
    }
    
    if (gridLayout.secondaryProp) {
      var secondaryValue = variant.properties[gridLayout.secondaryProp.name];
      gridRow = gridLayout.secondaryProp.values.indexOf(secondaryValue);
      if (gridRow === -1) gridRow = 0;
    }
    
    if (!gridLayout.primaryProp) {
      gridCol = variants.indexOf(variant);
    }
    
    // Calculate cell position within the grid
    var cellX = 0;
    for (var c = 0; c < gridCol; c++) {
      cellX += cellWidths[c];
    }
    
    var cellY = 0;
    for (var r = 0; r < gridRow; r++) {
      cellY += cellHeights[r];
    }
    
    // Get component dimensions safely
    var dimensions = getComponentDimensions(variant.component);
    
    // Center variant within its cell
    var cellWidth = cellWidths[gridCol];
    var cellHeight = cellHeights[gridRow];
    var variantX = Math.round(cellX + (cellWidth - dimensions.width) / 2);
    var variantY = Math.round(cellY + (cellHeight - dimensions.height) / 2);
    
    // Actually position the variant component
    variant.component.x = variantX;
    variant.component.y = variantY;
    
    variantsPositioned++;
    
    if (debugMode) {
      console.log("Positioned", variant.name, "at cell[", gridRow, "][", gridCol, "] - coords:", variantX + "," + variantY);
      console.log("  Cell bounds:", cellX + "," + cellY, "size:", cellWidth + "×" + cellHeight);
      console.log("  Component size:", dimensions.width + "×" + dimensions.height);
    }
  });
  
  if (debugMode) {
    console.log("Positioned", variantsPositioned, "variants total");
  }
  
  return { 
    variantsPositioned: variantsPositioned,
    totalVariants: variants.length
  };
}

async function executeStep8_AddLabels(debugMode, existingData) {
  if (debugMode) console.log("=== STEP 8: Labels & Property Names ===");
  
  if (!existingData.gridLayout) {
    throw new Error("Missing data. Run Steps 2, 3, and 4 first.");
  }
  
  // Get the current selection and components
  var selection = figma.currentPage.selection[0];
  if (!selection || selection.type !== "COMPONENT_SET") {
    throw new Error("Please select the component set");
  }
  
  var componentSet = selection;
  var wrapperFrame = componentSet.parent;
  
  if (!wrapperFrame || wrapperFrame.name.indexOf("Documentation") === -1) {
    throw new Error("Wrapper frame not found. Run Step 5 first.");
  }
  
  // Re-extract variant data to get actual component objects and calculate cells
  var variantData = extractVariantData(componentSet);
  var variants = variantData.variants;
  var gridLayout = existingData.gridLayout;
  var CELL_PADDING = 32;
  var LABEL_MARGIN = 24;
  var FIGMA_PURPLE = { r: 0.588, g: 0.278, b: 1 };
  
  if (debugMode) {
    console.log("Creating labels for", gridLayout.cols + "×" + gridLayout.rows, "grid");
  }
  
  // Load font for labels
  await figma.loadFontAsync({ family: "Inter", style: "Medium" });
  
  // Calculate cell dimensions (same logic as other steps)
  var rowHeights = [];
  var colWidths = [];
  
  // Initialize arrays
  for (var i = 0; i < gridLayout.rows; i++) {
    rowHeights[i] = 0;
  }
  for (var i = 0; i < gridLayout.cols; i++) {
    colWidths[i] = 0;
  }
  
  // Find max dimensions for each row and column
  variants.forEach(function(variant) {
    var gridCol = 0;
    var gridRow = 0;
    
    if (gridLayout.primaryProp) {
      var primaryValue = variant.properties[gridLayout.primaryProp.name];
      gridCol = gridLayout.primaryProp.values.indexOf(primaryValue);
      if (gridCol === -1) gridCol = 0;
    }
    
    if (gridLayout.secondaryProp) {
      var secondaryValue = variant.properties[gridLayout.secondaryProp.name];
      gridRow = gridLayout.secondaryProp.values.indexOf(secondaryValue);
      if (gridRow === -1) gridRow = 0;
    }
    
    if (!gridLayout.primaryProp) {
      gridCol = variants.indexOf(variant);
    }
    
    // Get component dimensions safely
    var dimensions = getComponentDimensions(variant.component);
    
    // Update max dimensions
    if (dimensions.width > colWidths[gridCol]) {
      colWidths[gridCol] = dimensions.width;
    }
    if (dimensions.height > rowHeights[gridRow]) {
      rowHeights[gridRow] = dimensions.height;
    }
  });
  
  // Add adaptive padding to each cell
  var cellWidths = colWidths.map(function(w) {
    var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, w * 0.8));
    return w + adaptivePadding;
  });
  var cellHeights = rowHeights.map(function(h) {
    var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, h * 0.8));
    return h + adaptivePadding;
  });
  
  var labelsCreated = 0;
  var parentFrame = wrapperFrame.parent;
  
  // Create column headers (primary property values) - positioned above wrapper frame
  if (gridLayout.primaryProp && gridLayout.cols > 1) {
    var currentX = 0;
    for (var col = 0; col < gridLayout.cols; col++) {
      var label = figma.createText();
      label.fontName = { family: "Inter", style: "Medium" };
      label.fontSize = 12;
      label.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
      label.characters = gridLayout.primaryProp.values[col];
      
      // Center the label above the cell
      var cellCenterX = wrapperFrame.x + currentX + (cellWidths[col] / 2);
      label.x = cellCenterX - (label.width / 2);
      label.y = wrapperFrame.y - LABEL_MARGIN - 16; // 16px for text height
      
      parentFrame.appendChild(label);
      labelsCreated++;
      currentX += cellWidths[col];
      
      if (debugMode) {
        console.log("Created column label '" + label.characters + "' at x=" + label.x);
      }
    }
    
    // Create primary property name label
    var primaryLabel = figma.createText();
    primaryLabel.fontName = { family: "Inter", style: "Medium" };
    primaryLabel.fontSize = 14;
    primaryLabel.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
    primaryLabel.characters = gridLayout.primaryProp.name;
    
    var totalWidth = cellWidths.reduce(function(sum, w) { return sum + w; }, 0);
    primaryLabel.x = wrapperFrame.x + (totalWidth / 2) - (primaryLabel.width / 2);
    primaryLabel.y = wrapperFrame.y - LABEL_MARGIN - 40; // Above column labels
    
    parentFrame.appendChild(primaryLabel);
    labelsCreated++;
    
    if (debugMode) {
      console.log("Created primary property label '" + primaryLabel.characters + "'");
    }
  }
  
  // Create row headers (secondary property values) - positioned to the left of wrapper frame
  if (gridLayout.secondaryProp && gridLayout.rows > 1) {
    var currentY = 0;
    for (var row = 0; row < gridLayout.rows; row++) {
      var label = figma.createText();
      label.fontName = { family: "Inter", style: "Medium" };
      label.fontSize = 12;
      label.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
      label.characters = gridLayout.secondaryProp.values[row];
      
      // Center the label to the left of the cell
      var cellCenterY = wrapperFrame.y + currentY + (cellHeights[row] / 2);
      label.x = wrapperFrame.x - LABEL_MARGIN - label.width;
      label.y = cellCenterY - 8; // Approximate text center offset
      
      parentFrame.appendChild(label);
      labelsCreated++;
      currentY += cellHeights[row];
      
      if (debugMode) {
        console.log("Created row label '" + label.characters + "' at y=" + label.y);
      }
    }
    
    // Create secondary property name label
    var secondaryLabel = figma.createText();
    secondaryLabel.fontName = { family: "Inter", style: "Medium" };
    secondaryLabel.fontSize = 14;
    secondaryLabel.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
    secondaryLabel.characters = gridLayout.secondaryProp.name;
    
    var totalHeight = cellHeights.reduce(function(sum, h) { return sum + h; }, 0);
    
    // Rotate the text 90 degrees and position it to the left
    secondaryLabel.rotation = -Math.PI / 2; // -90 degrees in radians
    secondaryLabel.x = wrapperFrame.x - LABEL_MARGIN - 30;
    secondaryLabel.y = wrapperFrame.y + (totalHeight / 2) + (secondaryLabel.width / 2); // width becomes height after rotation
    
    parentFrame.appendChild(secondaryLabel);
    labelsCreated++;
    
    if (debugMode) {
      console.log("Created secondary property label '" + secondaryLabel.characters + "' (rotated)");
    }
  }
  
  if (debugMode) {
    console.log("Created", labelsCreated, "labels total");
  }
  
  return { 
    labelsCreated: labelsCreated,
    columnLabels: gridLayout.primaryProp ? gridLayout.primaryProp.values.length : 0,
    rowLabels: gridLayout.secondaryProp ? gridLayout.secondaryProp.values.length : 0,
    propertyNames: (gridLayout.primaryProp ? 1 : 0) + (gridLayout.secondaryProp ? 1 : 0)
  };
}

// Debug functions for testing line creation
function createDebugTestLines() {
  try {
    var FIGMA_PURPLE = { r: 0.588, g: 0.278, b: 1 };
    
    // Create 100px horizontal line using rectangle
    var hLine = figma.createRectangle();
    hLine.name = "Debug Horizontal Line 100px";
    hLine.resize(100, 1); // 100px wide, 1px tall
    hLine.x = 0;
    hLine.y = 0;
    hLine.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
    hLine.strokes = [{ type: "SOLID", color: FIGMA_PURPLE }];
    hLine.strokeWeight = 1;
    hLine.dashPattern = [3, 3];
    hLine.opacity = 0.7;
    
    // Create 100px vertical line using rectangle  
    var vLine = figma.createRectangle();
    vLine.name = "Debug Vertical Line 100px";
    vLine.resize(1, 100); // 1px wide, 100px tall
    vLine.x = 0;
    vLine.y = 20; // Offset so we can see both lines
    vLine.fills = [{ type: "SOLID", color: FIGMA_PURPLE }];
    vLine.strokes = [{ type: "SOLID", color: FIGMA_PURPLE }];
    vLine.strokeWeight = 1;
    vLine.dashPattern = [3, 3];
    vLine.opacity = 0.7;
    
    // Add to current page
    figma.currentPage.appendChild(hLine);
    figma.currentPage.appendChild(vLine);
    
    // Select the lines so user can see them
    figma.currentPage.selection = [hLine, vLine];
    figma.viewport.scrollAndZoomIntoView([hLine, vLine]);
    
    figma.ui.postMessage({
      type: 'debug-test-lines-result',
      success: true,
      message: 'Created 100px horizontal and vertical test lines'
    });
    
    console.log("Debug: Created test lines successfully");
  } catch (error) {
    console.error("Debug line creation failed:", error);
    figma.ui.postMessage({
      type: 'debug-test-lines-result', 
      success: false,
      message: 'Failed to create test lines: ' + error.message
    });
  }
}

function clearDebugTestLines() {
  try {
    var linesRemoved = 0;
    
    // Find and remove debug lines
    figma.currentPage.children.forEach(function(child) {
      if (child.name.indexOf("Debug") === 0 && child.name.indexOf("Line") !== -1) {
        child.remove();
        linesRemoved++;
      }
    });
    
    figma.ui.postMessage({
      type: 'debug-test-lines-result',
      success: true, 
      message: 'Removed ' + linesRemoved + ' debug lines'
    });
    
    console.log("Debug: Removed", linesRemoved, "test lines");
  } catch (error) {
    console.error("Debug line clearing failed:", error);
    figma.ui.postMessage({
      type: 'debug-test-lines-result',
      success: false,
      message: 'Failed to clear test lines: ' + error.message
    });
  }
}

// The main() function is now only called through command handling above
// No automatic execution at the bottom of the file