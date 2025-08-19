// code.js
// ES5-compatible version for Figma plugin environment

async function main() {
  // Check if something is selected
  if (figma.currentPage.selection.length === 0) {
    figma.notify("Please select a component or component set");
    figma.closePlugin();
    return;
  }

  const selection = figma.currentPage.selection[0];
  let componentSet = null;

  // Find the component set
  if (selection.type === "COMPONENT_SET") {
    componentSet = selection;
  } else if (selection.type === "COMPONENT") {
    componentSet = selection.parent;
    if (componentSet.type !== "COMPONENT_SET") {
      figma.notify("Selected component is not part of a component set with variants");
      figma.closePlugin();
      return;
    }
  } else {
    figma.notify("Please select a component or component set");
    figma.closePlugin();
    return;
  }

  // Extract variant data
  const variantData = extractVariantData(componentSet);
  
  if (variantData.variants.length === 0) {
    figma.notify("No variants found in the selected component set");
    figma.closePlugin();
    return;
  }

  // Load fonts first
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
  } catch (error) {
    console.log("Error loading Inter font, trying system default");
    try {
      await figma.loadFontAsync({ family: "Helvetica", style: "Regular" });
      await figma.loadFontAsync({ family: "Helvetica", style: "Bold" });
    } catch (fallbackError) {
      figma.notify("Font loading failed. Using Figma defaults.");
    }
  }

  // Create integrated documentation
  await createIntegratedDocumentation(variantData, componentSet);
}

function extractVariantData(componentSet) {
  const variants = [];
  const propertyNames = new Set();
  
  // Iterate through all children (variants) of the component set
  componentSet.children.forEach(function(child) {
    if (child.type === "COMPONENT") {
      const variantProps = child.variantProperties || {};
      
      // Add property names to our set
      Object.keys(variantProps).forEach(function(prop) {
        propertyNames.add(prop);
      });
      
      variants.push({
        name: child.name,
        properties: variantProps,
        component: child,
        originalX: child.x,
        originalY: child.y
      });
    }
  });
  
  return {
    componentName: componentSet.name,
    variants: variants,
    propertyNames: Array.from(propertyNames).sort()
  };
}

function analyzeProperties(variants, propertyNames) {
  const propertyAnalysis = [];
  
  propertyNames.forEach(function(propName) {
    const uniqueValues = getUniqueValues(variants.map(function(v) { 
      return v.properties[propName]; 
    })).sort();
    
    const isBoolean = uniqueValues.length === 2 && 
      (uniqueValues.includes("True") && uniqueValues.includes("False") ||
       uniqueValues.includes("true") && uniqueValues.includes("false"));
    
    propertyAnalysis.push({
      name: propName,
      values: uniqueValues,
      count: uniqueValues.length,
      isBoolean: isBoolean
    });
  });
  
  return propertyAnalysis.sort(function(a, b) {
    if (a.isBoolean && !b.isBoolean) return 1;
    if (!a.isBoolean && b.isBoolean) return -1;
    return b.count - a.count;
  });
}

// Helper function to replace [...new Set(array)]
function getUniqueValues(array) {
  const unique = [];
  for (let i = 0; i < array.length; i++) {
    if (unique.indexOf(array[i]) === -1) {
      unique.push(array[i]);
    }
  }
  return unique;
}

function analyzeExistingLayout(variants) {
  console.log("=== DEBUG: Existing Layout Analysis ===");
  
  // Analyze the current layout of variants to understand the grid structure
  const positions = variants.map(function(v) {
    return { 
      x: v.originalX, 
      y: v.originalY, 
      width: v.component.width,
      height: v.component.height,
      variant: v 
    };
  });
  
  // Sort by position to understand the grid
  positions.sort(function(a, b) {
    if (Math.abs(a.y - b.y) < 10) { // Same row
      return a.x - b.x;
    }
    return a.y - b.y;
  });
  
  // Find unique X and Y positions
  const uniqueX = getUniqueValues(positions.map(function(p) { return p.x; })).sort(function(a, b) { return a - b; });
  const uniqueY = getUniqueValues(positions.map(function(p) { return p.y; })).sort(function(a, b) { return a - b; });
  
  console.log("Unique X positions:", uniqueX);
  console.log("Unique Y positions:", uniqueY);
  console.log("Grid dimensions:", uniqueX.length, "x", uniqueY.length);
  
  // Calculate cell dimensions using more robust approach
  let spacingBasedWidth = 200; // Default fallback
  let spacingBasedHeight = 120; // Default fallback
  
  if (uniqueX.length > 1) {
    spacingBasedWidth = uniqueX[1] - uniqueX[0];
  }
  
  if (uniqueY.length > 1) {
    spacingBasedHeight = uniqueY[1] - uniqueY[0];
  }
  
  // Find the largest component dimensions
  const maxComponentWidth = Math.max.apply(Math, variants.map(function(v) { return v.component.width; }));
  const maxComponentHeight = Math.max.apply(Math, variants.map(function(v) { return v.component.height; }));
  
  console.log("Spacing-based dimensions:", { width: spacingBasedWidth, height: spacingBasedHeight });
  console.log("Max component dimensions:", { width: maxComponentWidth, height: maxComponentHeight });
  
  // Use the more robust approach: larger of spacing-based or component-based + padding
  const cellWidth = Math.max(
    spacingBasedWidth, // Current spacing-based calculation
    maxComponentWidth + 40 // Largest component + padding
  );
  
  const cellHeight = Math.max(
    spacingBasedHeight, // Current spacing-based calculation
    maxComponentHeight + 60 // Largest component + padding (extra for labels)
  );
  
  console.log("Final cell dimensions:", { cellWidth: cellWidth, cellHeight: cellHeight });
  
  return {
    positions: positions,
    uniqueX: uniqueX,
    uniqueY: uniqueY,
    cellWidth: cellWidth,
    cellHeight: cellHeight,
    gridCols: uniqueX.length,
    gridRows: uniqueY.length,
    spacingBasedWidth: spacingBasedWidth,
    spacingBasedHeight: spacingBasedHeight,
    maxComponentWidth: maxComponentWidth,
    maxComponentHeight: maxComponentHeight
  };
}

function findMissingVariants(variants, propertyAnalysis) {
  // Find all possible combinations
  const allCombinations = [];
  
  function generateCombinations(props, current, index) {
    if (current === undefined) current = {};
    if (index === undefined) index = 0;
    
    if (index === props.length) {
      // Create a copy of current object
      const copy = {};
      Object.keys(current).forEach(function(key) {
        copy[key] = current[key];
      });
      allCombinations.push(copy);
      return;
    }
    
    const prop = props[index];
    for (let i = 0; i < prop.values.length; i++) {
      const value = prop.values[i];
      current[prop.name] = value;
      generateCombinations(props, current, index + 1);
    }
    delete current[prop.name];
  }
  
  generateCombinations(propertyAnalysis);
  
  // Find missing combinations
  const existingCombinations = variants.map(function(v) { return v.properties; });
  const missingCombinations = allCombinations.filter(function(combo) {
    return !existingCombinations.some(function(existing) {
      return Object.keys(combo).every(function(key) {
        return existing[key] === combo[key];
      });
    });
  });
  
  console.log("=== DEBUG: Missing Variants Analysis ===");
  console.log("Total possible combinations:", allCombinations.length);
  console.log("Existing combinations:", existingCombinations.length);
  console.log("Missing combinations:", missingCombinations.length);
  
  return { allCombinations: allCombinations, missingCombinations: missingCombinations };
}

async function createIntegratedDocumentation(variantData, componentSet) {
  const variants = variantData.variants;
  const propertyNames = variantData.propertyNames;
  
  // Constants
  const FIGMA_PURPLE = { r: 0.59, g: 0.28, b: 1 }; // #9747FF
  const LABEL_SIZE = 12;
  const PADDING = 20;
  
  console.log("=== DEBUG: Starting integrated documentation ===");
  console.log("Total variants:", variants.length);
  console.log("Property names:", propertyNames);
  
  // Analyze properties
  const propertyAnalysis = analyzeProperties(variants, propertyNames);
  console.log("Property analysis:", propertyAnalysis);
  
  // Analyze existing layout
  const layoutAnalysis = analyzeExistingLayout(variants);
  
  // Find missing variants
  const missingVariantsResult = findMissingVariants(variants, propertyAnalysis);
  const missingCombinations = missingVariantsResult.missingCombinations;
  console.log("Missing combinations:", missingCombinations);
  
  // Calculate expanded grid to accommodate missing variants
  const expandedLayout = calculateExpandedGrid(variants, missingCombinations, layoutAnalysis, propertyAnalysis);
  
  // Create documentation frame positioned at original component set location
  const docFrame = figma.createFrame();
  docFrame.name = componentSet.name + " - Complete Documentation";
  
  const totalWidth = Math.max(expandedLayout.totalCols * layoutAnalysis.cellWidth + PADDING * 2, 400);
  const totalHeight = Math.max(expandedLayout.totalRows * layoutAnalysis.cellHeight + PADDING * 2 + 120, 300);
  
  docFrame.resize(totalWidth, totalHeight);
  docFrame.fills = [];
  docFrame.clipsContent = false;
  // Fix positioning: use original component set position as base
  docFrame.x = componentSet.x - PADDING;
  docFrame.y = componentSet.y - 80;
  
  console.log("Documentation frame positioned at:", {
    x: docFrame.x,
    y: docFrame.y,
    originalComponentSetPos: { x: componentSet.x, y: componentSet.y },
    expandedGrid: expandedLayout.totalCols + "x" + expandedLayout.totalRows
  });
  
  // Step 1: Add documentation overlays for existing variants (no instances)
  for (let i = 0; i < variants.length; i++) {
    await addDocumentationOverlay(docFrame, variants[i], propertyAnalysis, layoutAnalysis, FIGMA_PURPLE, LABEL_SIZE, PADDING, componentSet);
  }
  
  // Step 2: Create actual component instances for missing combinations
  if (missingCombinations.length > 0) {
    await createMissingVariantInstances(docFrame, missingCombinations, variants, expandedLayout, layoutAnalysis, propertyAnalysis, FIGMA_PURPLE, LABEL_SIZE, PADDING, componentSet);
  }
  
  // Step 3: Add unified grid lines covering all variants
  await addUnifiedGridLines(docFrame, expandedLayout, layoutAnalysis, FIGMA_PURPLE, PADDING);
  
  // Step 4: Add comprehensive property labels
  await addIntegratedPropertyLabels(docFrame, propertyAnalysis, FIGMA_PURPLE, LABEL_SIZE, PADDING);
  
  // Select the complete documentation
  figma.currentPage.selection = [docFrame];
  figma.viewport.scrollAndZoomIntoView([docFrame]);
  
  figma.notify("Documented " + variants.length + " existing variants and created " + missingCombinations.length + " missing variant instances");
  figma.closePlugin();
}

function calculateExpandedGrid(variants, missingCombinations, layoutAnalysis, propertyAnalysis) {
  console.log("=== DEBUG: Calculating expanded grid (handling 3+ properties) ===");
  
  // Handle different property counts more intelligently
  if (propertyAnalysis.length === 0) {
    return createSimpleGrid(variants, [], []);
  } else if (propertyAnalysis.length === 1) {
    return createSinglePropertyGrid(variants, propertyAnalysis[0]);
  } else if (propertyAnalysis.length === 2) {
    return createTwoPropertyGrid(variants, propertyAnalysis);
  } else {
    // 3+ properties - need more sophisticated handling
    return createMultiPropertyGrid(variants, propertyAnalysis);
  }
}

function createSimpleGrid(variants, primaryProp, secondaryProp) {
  return {
    totalCols: Math.max(1, variants.length),
    totalRows: 1,
    primaryProp: null,
    secondaryProp: null,
    existingPositions: new Map(),
    gridMapping: { primaryValues: [""], secondaryValues: [""] },
    remainingProperties: []
  };
}

function createSinglePropertyGrid(variants, prop) {
  return {
    totalCols: prop.count,
    totalRows: 1,
    primaryProp: prop,
    secondaryProp: null,
    existingPositions: new Map(),
    gridMapping: { primaryValues: prop.values, secondaryValues: [""] },
    remainingProperties: []
  };
}

function createTwoPropertyGrid(variants, propertyAnalysis) {
  // Create a copy and sort it
  const sortedProps = propertyAnalysis.slice().sort(function(a, b) { return b.count - a.count; });
  const primaryProp = sortedProps[0];
  const secondaryProp = sortedProps[1];
  
  console.log("Two-property grid:", {
    primary: primaryProp.name + " (" + primaryProp.count + " values)",
    secondary: secondaryProp.name + " (" + secondaryProp.count + " values)"
  });
  
  const existingPositions = new Map();
  variants.forEach(function(variant) {
    const primaryValue = variant.properties[primaryProp.name];
    const secondaryValue = variant.properties[secondaryProp.name];
    const key = primaryValue + "_" + secondaryValue;
    existingPositions.set(key, {
      variant: variant,
      gridCol: primaryProp.values.indexOf(primaryValue),
      gridRow: secondaryProp.values.indexOf(secondaryValue)
    });
  });
  
  return {
    totalCols: primaryProp.count,
    totalRows: secondaryProp.count,
    primaryProp: primaryProp,
    secondaryProp: secondaryProp,
    existingPositions: existingPositions,
    gridMapping: { primaryValues: primaryProp.values, secondaryValues: secondaryProp.values },
    remainingProperties: []
  };
}

function createMultiPropertyGrid(variants, propertyAnalysis) {
  console.log("Multi-property grid (3+ properties):", propertyAnalysis.map(function(p) { return p.name + " (" + p.count + ")"; }));
  
  // Strategy for 3+ properties:
  // 1. Use the two largest non-boolean properties for main axes
  // 2. Treat remaining properties as "cell variants" - multiple variants per cell
  
  // Separate boolean and non-boolean properties
  const booleanProps = propertyAnalysis.filter(function(p) { return p.isBoolean; });
  const nonBooleanProps = propertyAnalysis.filter(function(p) { return !p.isBoolean; });
  
  // Sort non-boolean properties by count (largest first)
  const sortedNonBoolean = nonBooleanProps.slice().sort(function(a, b) { return b.count - a.count; });
  
  let primaryProp, secondaryProp;
  
  if (sortedNonBoolean.length >= 2) {
    // Use two largest non-boolean properties for axes
    primaryProp = sortedNonBoolean[0];
    secondaryProp = sortedNonBoolean[1];
  } else if (sortedNonBoolean.length === 1) {
    // One non-boolean property + one boolean property
    primaryProp = sortedNonBoolean[0];
    secondaryProp = booleanProps[0] || sortedNonBoolean[0];
  } else {
    // All boolean properties - use first two
    primaryProp = booleanProps[0];
    secondaryProp = booleanProps[1] || booleanProps[0];
  }
  
  console.log("Selected grid axes:", {
    primary: (primaryProp ? primaryProp.name : "none") + " (" + (primaryProp ? primaryProp.count : 0) + " values)",
    secondary: (secondaryProp ? secondaryProp.name : "none") + " (" + (secondaryProp ? secondaryProp.count : 0) + " values)"
  });
  
  // Calculate remaining properties (not used for axes)
  const usedPropertyNames = [primaryProp ? primaryProp.name : null, secondaryProp ? secondaryProp.name : null].filter(Boolean);
  const remainingProperties = propertyAnalysis.filter(function(p) { 
    return usedPropertyNames.indexOf(p.name) === -1; 
  });
  
  console.log("Remaining properties (will create cell variants):", remainingProperties.map(function(p) { return p.name; }));
  
  // Create grid mapping for variants
  const existingPositions = new Map();
  
  if (primaryProp && secondaryProp && primaryProp !== secondaryProp) {
    variants.forEach(function(variant) {
      const primaryValue = variant.properties[primaryProp.name];
      const secondaryValue = variant.properties[secondaryProp.name];
      const key = primaryValue + "_" + secondaryValue;
      
      if (!existingPositions.has(key)) {
        existingPositions.set(key, []);
      }
      existingPositions.get(key).push({
        variant: variant,
        gridCol: primaryProp.values.indexOf(primaryValue),
        gridRow: secondaryProp.values.indexOf(secondaryValue)
      });
    });
  }
  
  return {
    totalCols: primaryProp ? primaryProp.count : 1,
    totalRows: secondaryProp ? secondaryProp.count : 1,
    primaryProp: primaryProp,
    secondaryProp: secondaryProp,
    existingPositions: existingPositions,
    gridMapping: { 
      primaryValues: primaryProp ? primaryProp.values : [""], 
      secondaryValues: secondaryProp ? secondaryProp.values : [""] 
    },
    remainingProperties: remainingProperties
  };
}

function Boolean(value) {
  return !!value;
}

async function addDocumentationOverlay(docFrame, variant, propertyAnalysis, layoutAnalysis, color, labelSize, padding, componentSet) {
  console.log("Adding overlay for variant: " + variant.name);
  
  // Work with the original component, don't create an instance
  const originalComponent = variant.component;
  
  // Calculate position relative to the documentation frame, using componentSet as base
  const relativeX = originalComponent.x - componentSet.x + padding;
  const relativeY = originalComponent.y - componentSet.y + padding + 80;
  
  // Add a subtle overlay to indicate this variant is documented
  const overlay = figma.createRectangle();
  overlay.resize(originalComponent.width + 4, originalComponent.height + 4);
  overlay.x = relativeX - 2;
  overlay.y = relativeY - 2;
  overlay.fills = [];
  overlay.strokes = [{ type: "SOLID", color: color }];
  overlay.strokeWeight = 1;
  overlay.cornerRadius = 2;
  overlay.opacity = 0.3;
  overlay.name = "Overlay_" + variant.name;
  
  docFrame.appendChild(overlay);
}

async function createMissingVariantInstances(docFrame, missingCombinations, existingVariants, expandedLayout, layoutAnalysis, propertyAnalysis, color, labelSize, padding, componentSet) {
  console.log("=== DEBUG: Creating missing variant instances (multi-property support) ===");
  console.log("Missing combinations to create:", missingCombinations.length);
  console.log("Remaining properties:", expandedLayout.remainingProperties ? expandedLayout.remainingProperties.map(function(p) { return p.name; }) : []);
  
  // Find a base component to use for creating missing variants
  const baseComponent = existingVariants[0].component;
  
  for (let i = 0; i < missingCombinations.length; i++) {
    const missingCombo = missingCombinations[i];
    
    if (!expandedLayout.primaryProp) {
      console.log("No primary property defined, skipping missing variant creation");
      continue;
    }
    
    const primaryValue = missingCombo[expandedLayout.primaryProp.name];
    const secondaryValue = expandedLayout.secondaryProp ? 
      missingCombo[expandedLayout.secondaryProp.name] : "";
    
    // Calculate grid position
    const gridCol = expandedLayout.gridMapping.primaryValues.indexOf(primaryValue);
    const gridRow = expandedLayout.gridMapping.secondaryValues.indexOf(secondaryValue);
    
    // Skip if position is invalid
    if (gridCol === -1 || gridRow === -1) {
      console.log("Skipping invalid grid position for:", missingCombo);
      continue;
    }
    
    // Calculate actual position in the documentation frame - centered in cell
    const cellX = padding + gridCol * layoutAnalysis.cellWidth;
    const cellY = padding + 80 + gridRow * layoutAnalysis.cellHeight;
    
    // Center the instance within the cell
    const x = cellX + (layoutAnalysis.cellWidth - baseComponent.width) / 2;
    const y = cellY + (layoutAnalysis.cellHeight - baseComponent.height) / 2;
    
    console.log("Creating missing variant at grid[" + gridRow + "][" + gridCol + "] for:", missingCombo);
    
    // Create instance of the base component
    const instance = baseComponent.createInstance();
    
    // Position the instance (centered in cell)
    instance.x = x;
    instance.y = y;
    
    // Create comprehensive name showing all properties
    const allProps = Object.keys(missingCombo).map(function(k) {
      return k + "=" + missingCombo[k];
    }).join(", ");
    instance.name = "Missing: " + allProps;
    
    docFrame.appendChild(instance);
    
    // Add styling to indicate this is a missing variant
    const missingOverlay = figma.createRectangle();
    missingOverlay.resize(instance.width, instance.height);
    missingOverlay.x = instance.x;
    missingOverlay.y = instance.y;
    missingOverlay.fills = [{ 
      type: "SOLID", 
      color: { r: 1, g: 0.95, b: 0.8 }, 
      opacity: 0.7 
    }];
    missingOverlay.strokes = [{ type: "SOLID", color: color }];
    missingOverlay.strokeWeight = 2;
    missingOverlay.dashPattern = [4, 4];
    missingOverlay.cornerRadius = 4;
    missingOverlay.name = "Missing_Overlay_" + instance.name;
    
    docFrame.appendChild(missingOverlay);
    
    // Add "MISSING" label with fallback font handling
    const missingLabel = figma.createText();
    try {
      missingLabel.fontName = { family: "Inter", style: "Medium" };
    } catch (fontError) {
      try {
        missingLabel.fontName = { family: "Helvetica", style: "Bold" };
      } catch (fallbackError) {
        console.log("Using system default font for missing label");
      }
    }
    missingLabel.characters = "MISSING";
    missingLabel.fontSize = 10;
    missingLabel.fills = [{ type: "SOLID", color: { r: 0.8, g: 0.4, b: 0 } }];
    missingLabel.textAlignHorizontal = "CENTER";
    
    missingLabel.x = instance.x + (instance.width - missingLabel.width) / 2;
    missingLabel.y = instance.y + 5;
    
    docFrame.appendChild(missingLabel);
    
    // Add labels for remaining properties (properties not used for grid axes)
    if (expandedLayout.remainingProperties && expandedLayout.remainingProperties.length > 0) {
      let labelY = instance.y + instance.height + 10;
      
      for (let j = 0; j < expandedLayout.remainingProperties.length; j++) {
        const prop = expandedLayout.remainingProperties[j];
        const value = missingCombo[prop.name];
        if (value !== undefined) {
          const label = figma.createText();
          try {
            label.fontName = { family: "Inter", style: "Regular" };
          } catch (fontError) {
            try {
              label.fontName = { family: "Helvetica", style: "Regular" };
            } catch (fallbackError) {
              console.log("Using system default font for property label");
            }
          }
          
          if (prop.isBoolean) {
            label.characters = prop.name + ": " + value;
          } else {
            label.characters = prop.name + ": " + value;
          }
          
          label.fontSize = 9;
          label.fills = [{ type: "SOLID", color: color }];
          label.textAlignHorizontal = "CENTER";
          
          label.x = instance.x + (instance.width - label.width) / 2;
          label.y = labelY;
          
          docFrame.appendChild(label);
          labelY += 11;
        }
      }
    }
  }
  
  console.log("✅ Created " + missingCombinations.length + " missing variant instances with full property support");
}

async function addUnifiedGridLines(docFrame, expandedLayout, layoutAnalysis, color, padding) {
  const gridWidth = expandedLayout.totalCols * layoutAnalysis.cellWidth;
  const gridHeight = expandedLayout.totalRows * layoutAnalysis.cellHeight;
  
  // Outer border around the complete grid - 1px stroke weight
  const outerBorder = figma.createRectangle();
  outerBorder.resize(gridWidth + 8, gridHeight + 8);
  outerBorder.x = padding - 4;
  outerBorder.y = padding + 80 - 4;
  outerBorder.fills = [];
  outerBorder.strokes = [{ type: "SOLID", color: color }];
  outerBorder.strokeWeight = 1; // 1px outer border
  outerBorder.dashPattern = [6, 6];
  outerBorder.cornerRadius = 8;
  outerBorder.name = "Complete_Grid_Border";
  
  docFrame.appendChild(outerBorder);
  
  // Vertical grid lines
  for (let col = 1; col < expandedLayout.totalCols; col++) {
    const line = figma.createLine();
    const lineX = padding + col * layoutAnalysis.cellWidth;
    const lineY = padding + 80;
    
    line.x = lineX;
    line.y = lineY;
    line.resize(0, gridHeight);
    line.strokes = [{ type: "SOLID", color: color }];
    line.strokeWeight = 1;
    line.dashPattern = [3, 3];
    line.name = "Grid_Line_Col_" + col;
    
    docFrame.appendChild(line);
  }
  
  // Horizontal grid lines
  for (let row = 1; row < expandedLayout.totalRows; row++) {
    const line = figma.createLine();
    line.x = padding;
    line.y = padding + 80 + row * layoutAnalysis.cellHeight;
    line.resize(gridWidth, 0);
    line.strokes = [{ type: "SOLID", color: color }];
    line.strokeWeight = 1;
    line.dashPattern = [3, 3];
    line.name = "Grid_Line_Row_" + row;
    
    docFrame.appendChild(line);
  }
  
  // Add row and column labels if we have valid properties
  if (expandedLayout.primaryProp && expandedLayout.secondaryProp) {
    await addGridAxisLabels(docFrame, expandedLayout, layoutAnalysis, color, padding);
  }
}

async function addGridAxisLabels(docFrame, expandedLayout, layoutAnalysis, color, padding) {
  // Column labels (top)
  for (let col = 0; col < expandedLayout.totalCols; col++) {
    const value = expandedLayout.gridMapping.primaryValues[col];
    
    const label = figma.createText();
    try {
      label.fontName = { family: "Inter", style: "Regular" };
    } catch (fontError) {
      try {
        label.fontName = { family: "Helvetica", style: "Regular" };
      } catch (fallbackError) {
        console.log("Using system default font for column label");
      }
    }
    label.characters = value || "";
    label.fontSize = 12;
    label.fills = [{ type: "SOLID", color: color }];
    label.textAlignHorizontal = "CENTER";
    
    const x = padding + col * layoutAnalysis.cellWidth + layoutAnalysis.cellWidth / 2;
    const y = padding + 50;
    
    label.x = x - label.width / 2;
    label.y = y;
    
    docFrame.appendChild(label);
  }
  
  // Row labels (left)
  for (let row = 0; row < expandedLayout.totalRows; row++) {
    const value = expandedLayout.gridMapping.secondaryValues[row];
    
    const label = figma.createText();
    try {
      label.fontName = { family: "Inter", style: "Regular" };
    } catch (fontError) {
      try {
        label.fontName = { family: "Helvetica", style: "Regular" };
      } catch (fallbackError) {
        console.log("Using system default font for row label");
      }
    }
    label.characters = value || "";
    label.fontSize = 12;
    label.fills = [{ type: "SOLID", color: color }];
    label.textAlignHorizontal = "RIGHT";
    
    const x = padding - 10;
    const y = padding + 80 + row * layoutAnalysis.cellHeight + layoutAnalysis.cellHeight / 2;
    
    label.x = x - label.width;
    label.y = y - label.height / 2;
    
    docFrame.appendChild(label);
  }
  
  // Property name labels
  if (expandedLayout.primaryProp) {
    const primaryLabel = figma.createText();
    try {
      primaryLabel.fontName = { family: "Inter", style: "Medium" };
    } catch (fontError) {
      try {
        primaryLabel.fontName = { family: "Helvetica", style: "Bold" };
      } catch (fallbackError) {
        console.log("Using system default font for primary label");
      }
    }
    primaryLabel.characters = expandedLayout.primaryProp.name;
    primaryLabel.fontSize = 14;
    primaryLabel.fills = [{ type: "SOLID", color: color }];
    primaryLabel.textAlignHorizontal = "CENTER";
    
    const gridWidth = expandedLayout.totalCols * layoutAnalysis.cellWidth;
    primaryLabel.x = padding + gridWidth / 2 - primaryLabel.width / 2;
    primaryLabel.y = padding + 25;
    
    docFrame.appendChild(primaryLabel);
  }
  
  if (expandedLayout.secondaryProp) {
    const secondaryLabel = figma.createText();
    try {
      secondaryLabel.fontName = { family: "Inter", style: "Medium" };
    } catch (fontError) {
      try {
        secondaryLabel.fontName = { family: "Helvetica", style: "Bold" };
      } catch (fallbackError) {
        console.log("Using system default font for secondary label");
      }
    }
    secondaryLabel.characters = expandedLayout.secondaryProp.name;
    secondaryLabel.fontSize = 14;
    secondaryLabel.fills = [{ type: "SOLID", color: color }];
    secondaryLabel.textAlignHorizontal = "CENTER";
    
    const gridHeight = expandedLayout.totalRows * layoutAnalysis.cellHeight;
    secondaryLabel.x = padding - 80;
    secondaryLabel.y = padding + 80 + gridHeight / 2 - secondaryLabel.width / 2;
    secondaryLabel.rotation = -90;
    
    docFrame.appendChild(secondaryLabel);
  }
}

async function addIntegratedPropertyLabels(docFrame, propertyAnalysis, color, labelSize, padding) {
  // Add a title for the documentation
  const title = figma.createText();
  try {
    title.fontName = { family: "Inter", style: "Medium" };
  } catch (fontError) {
    try {
      title.fontName = { family: "Helvetica", style: "Bold" };
    } catch (fallbackError) {
      console.log("Using system default font for title");
    }
  }
  title.characters = "Component Variant Documentation";
  title.fontSize = 16;
  title.fills = [{ type: "SOLID", color: color }];
  title.textAlignHorizontal = "LEFT";
  
  title.x = padding;
  title.y = padding - 60;
  
  docFrame.appendChild(title);
  
  // Add property summary
  if (propertyAnalysis.length > 0) {
    const summary = figma.createText();
    try {
      summary.fontName = { family: "Inter", style: "Regular" };
    } catch (fontError) {
      try {
        summary.fontName = { family: "Helvetica", style: "Regular" };
      } catch (fallbackError) {
        console.log("Using system default font for summary");
      }
    }
    
    const propSummary = propertyAnalysis.map(function(p) {
      return p.name + ": " + p.values.join(", ");
    }).join(" | ");
    
    summary.characters = "Properties: " + propSummary;
    summary.fontSize = 12;
    summary.fills = [{ type: "SOLID", color: color }];
    summary.textAlignHorizontal = "LEFT";
    
    summary.x = padding;
    summary.y = padding - 35;
    
    docFrame.appendChild(summary);
  }
}

// Helper function to filter arrays (replaces array.filter)
function filterArray(array, predicate) {
  const result = [];
  for (let i = 0; i < array.length; i++) {
    if (predicate(array[i], i, array)) {
      result.push(array[i]);
    }
  }
  return result;
}

// Helper function to check if value exists in array (replaces array.includes)
function arrayIncludes(array, value) {
  for (let i = 0; i < array.length; i++) {
    if (array[i] === value) {
      return true;
    }
  }
  return false;
}

// Run the plugin with error handling
main().catch(function(error) {
  console.error("Plugin error:", error);
  figma.notify("Plugin encountered an error. Check console for details.");
  figma.closePlugin();
});