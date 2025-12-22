// shadcn/ui Theme Switcher for Figma
// Based on official shadcn theme CSS files (Vega, Nova, Maia, Lyra, Mira)
// Extracted from actual Tailwind classes used in each theme

// ============================================================================
// THEME DEFINITIONS - Extracted from official shadcn CSS
// ============================================================================

// Tailwind border-radius values (in pixels)
// rounded-none=0, rounded-sm=2, rounded=4, rounded-md=6, rounded-lg=8, 
// rounded-xl=12, rounded-2xl=16, rounded-3xl=24, rounded-full=9999
var RADIUS_VALUES = {
  'radius-0': 0,
  'radius-2': 2,
  'radius-4': 4,
  'radius-6': 6,
  'radius-8': 8,
  'radius-12': 12,
  'radius-16': 16,
  'radius-24': 24,
  'radius-32': 32,
  'radius-9999': 9999
};

// Tailwind spacing scale (in pixels) - base unit is 4px
// 0=0, 0.5=2, 1=4, 1.5=6, 2=8, 2.5=10, 3=12, 4=16, 5=20, 6=24, 7=28, 8=32, 9=36, 10=40
var SPACING_VALUES = {
  '0': 0,
  '0.5': 2,
  '1': 4,
  '1.5': 6,
  '2': 8,
  '2.5': 10,
  '3': 12,
  '4': 16,
  '5': 20,
  '6': 24,
  '7': 28,
  '8': 32,
  '9': 36,
  '10': 40,
  '11': 44,
  '12': 48,
  '14': 56,
  '16': 64,
  '20': 80,
  '24': 96
};

// ============================================================================
// COMPONENT-LEVEL THEME DATA (from CSS analysis)
// ============================================================================
// This maps specific component properties per theme

var COMPONENT_THEMES = {
  vega: {
    // Buttons
    buttonDefaultHeight: 36,    // h-9
    buttonSmHeight: 32,         // h-8  
    buttonXsHeight: 24,         // h-6
    buttonLgHeight: 40,         // h-10
    buttonRadius: 6,            // rounded-md
    buttonIconSize: 16,         // size-4
    
    // Inputs
    inputHeight: 36,            // h-9
    inputRadius: 6,             // rounded-md
    inputPaddingX: 10,          // px-2.5
    
    // Cards
    cardRadius: 12,             // rounded-xl
    cardPadding: 24,            // p-6
    cardGap: 24,                // gap-6
    
    // Dialogs/Popovers
    dialogRadius: 12,           // rounded-xl
    popoverRadius: 8,           // rounded-lg
    dropdownRadius: 8,          // rounded-lg
    
    // Menu items
    menuItemRadius: 4,          // rounded-sm
    menuItemPadding: 8,         // py-2
    
    // Checkboxes
    checkboxRadius: 4,          // rounded-[4px]
    
    // Focus ring
    focusRingWidth: 3,          // ring-[3px]
    
    // Shadows
    shadowLevel: 'md',
    
    // Text
    baseTextSize: 14            // text-sm
  },
  
  nova: {
    // Buttons - SMALLER heights
    buttonDefaultHeight: 32,    // h-8 (vs h-9)
    buttonSmHeight: 28,         // h-7 (vs h-8)
    buttonXsHeight: 24,         // h-6
    buttonLgHeight: 36,         // h-9 (vs h-10)
    buttonRadius: 8,            // rounded-lg
    buttonIconSize: 16,         // size-4
    
    // Inputs - SMALLER
    inputHeight: 32,            // h-8
    inputRadius: 8,             // rounded-lg
    inputPaddingX: 6,           // px-1.5
    
    // Cards - TIGHTER padding
    cardRadius: 12,             // rounded-xl
    cardPadding: 16,            // p-4 (vs p-6)
    cardGap: 16,                // gap-4 (vs gap-6)
    
    // Dialogs/Popovers
    dialogRadius: 12,           // rounded-xl
    popoverRadius: 8,           // rounded-lg
    dropdownRadius: 8,          // rounded-lg
    
    // Menu items - TIGHTER
    menuItemRadius: 4,          // rounded-sm
    menuItemPadding: 6,         // py-1.5 (vs py-2)
    
    // Checkboxes
    checkboxRadius: 4,          // rounded-[4px]
    
    // Focus ring
    focusRingWidth: 3,          // ring-[3px]
    
    // Shadows
    shadowLevel: 'md',
    
    // Text
    baseTextSize: 14            // text-sm
  },
  
  maia: {
    // Buttons - PILL shaped
    buttonDefaultHeight: 36,    // h-9
    buttonSmHeight: 32,         // h-8
    buttonXsHeight: 24,         // h-6
    buttonLgHeight: 40,         // h-10
    buttonRadius: 9999,         // rounded-4xl (pill)
    buttonIconSize: 16,         // size-4
    
    // Inputs - ROUNDER
    inputHeight: 36,            // h-9
    inputRadius: 9999,          // rounded-4xl (pill)
    inputPaddingX: 12,          // px-3 (more padding)
    
    // Cards - LARGER radius, MORE padding
    cardRadius: 24,             // rounded-2xl (vs rounded-xl)
    cardPadding: 24,            // p-6
    cardGap: 24,                // gap-6
    
    // Dialogs/Popovers - ROUNDER
    dialogRadius: 24,           // rounded-2xl
    popoverRadius: 16,          // rounded-xl (vs rounded-lg)
    dropdownRadius: 16,         // rounded-xl
    
    // Menu items - ROUNDER
    menuItemRadius: 12,         // rounded-xl (vs rounded-sm)
    menuItemPadding: 12,        // py-3 (vs py-2)
    
    // Checkboxes - ROUNDER
    checkboxRadius: 6,          // rounded-[6px] (vs 4px)
    
    // Focus ring
    focusRingWidth: 3,          // ring-[3px]
    
    // Shadows - HEAVIER
    shadowLevel: '2xl',         // shadow-2xl (vs shadow-md)
    
    // Text
    baseTextSize: 14            // text-sm
  },
  
  lyra: {
    // Buttons - SQUARE, compact
    buttonDefaultHeight: 32,    // h-8
    buttonSmHeight: 28,         // h-7
    buttonXsHeight: 24,         // h-6
    buttonLgHeight: 36,         // h-9
    buttonRadius: 0,            // rounded-none
    buttonIconSize: 16,         // size-4
    
    // Inputs - SQUARE
    inputHeight: 32,            // h-8
    inputRadius: 0,             // rounded-none
    inputPaddingX: 10,          // px-2.5
    
    // Cards - SQUARE
    cardRadius: 0,              // rounded-none
    cardPadding: 16,            // p-4
    cardGap: 16,                // gap-4
    
    // Dialogs/Popovers - SQUARE
    dialogRadius: 0,            // rounded-none
    popoverRadius: 0,           // rounded-none
    dropdownRadius: 0,          // rounded-none
    
    // Menu items - SQUARE
    menuItemRadius: 0,          // rounded-none
    menuItemPadding: 8,         // py-2
    
    // Checkboxes - SQUARE
    checkboxRadius: 0,          // rounded-none
    
    // Focus ring - THINNER
    focusRingWidth: 1,          // ring-1 (vs ring-[3px])
    
    // Shadows
    shadowLevel: 'md',
    
    // Text - SMALLER
    baseTextSize: 12            // text-xs
  },
  
  mira: {
    // Buttons - SMALLEST heights
    buttonDefaultHeight: 28,    // h-7 (smallest)
    buttonSmHeight: 24,         // h-6
    buttonXsHeight: 20,         // h-5
    buttonLgHeight: 32,         // h-8
    buttonRadius: 6,            // rounded-md
    buttonIconSize: 14,         // size-3.5
    
    // Inputs - SMALLEST
    inputHeight: 28,            // h-7
    inputRadius: 6,             // rounded-md
    inputPaddingX: 8,           // px-2
    
    // Cards - TIGHTEST
    cardRadius: 8,              // rounded-lg (vs rounded-xl)
    cardPadding: 16,            // p-4
    cardGap: 16,                // gap-4
    
    // Dialogs/Popovers - SMALLER radius
    dialogRadius: 12,           // rounded-xl
    popoverRadius: 8,           // rounded-lg
    dropdownRadius: 8,          // rounded-lg
    
    // Menu items - COMPACT
    menuItemRadius: 6,          // rounded-md
    menuItemPadding: 4,         // py-1
    
    // Checkboxes
    checkboxRadius: 4,          // rounded-[4px]
    
    // Focus ring - MEDIUM
    focusRingWidth: 2,          // ring-[2px]
    
    // Shadows
    shadowLevel: 'md',
    
    // Text - SMALLEST
    baseTextSize: 12            // text-xs
  }
};

// ============================================================================
// SEMANTIC TOKEN MAPPINGS
// ============================================================================
// Maps semantic radius tokens to absolute values per theme

var RADIUS_THEMES = {
  // VEGA - Classic, standard (baseline)
  vega: {
    'rounded-xs': 'radius-2',
    'rounded-sm': 'radius-4',
    'rounded-md': 'radius-6',
    'rounded-lg': 'radius-8',
    'rounded-xl': 'radius-12',
    'rounded-2xl': 'radius-16',
    'rounded-3xl': 'radius-24',
    'rounded-4xl': 'radius-9999',
    'rounded-full': 'radius-9999'
  },
  
  // NOVA - Same radii as Vega (compact is about spacing, not radii)
  nova: {
    'rounded-xs': 'radius-2',
    'rounded-sm': 'radius-4',
    'rounded-md': 'radius-6',
    'rounded-lg': 'radius-8',
    'rounded-xl': 'radius-12',
    'rounded-2xl': 'radius-16',
    'rounded-3xl': 'radius-24',
    'rounded-4xl': 'radius-9999',
    'rounded-full': 'radius-9999'
  },
  
  // MAIA - Larger radii (+1 step), pill buttons
  maia: {
    'rounded-xs': 'radius-4',
    'rounded-sm': 'radius-6',
    'rounded-md': 'radius-8',
    'rounded-lg': 'radius-12',
    'rounded-xl': 'radius-16',
    'rounded-2xl': 'radius-24',
    'rounded-3xl': 'radius-32',
    'rounded-4xl': 'radius-9999',
    'rounded-full': 'radius-9999'
  },
  
  // LYRA - All square (brutalist)
  lyra: {
    'rounded-xs': 'radius-0',
    'rounded-sm': 'radius-0',
    'rounded-md': 'radius-0',
    'rounded-lg': 'radius-0',
    'rounded-xl': 'radius-0',
    'rounded-2xl': 'radius-0',
    'rounded-3xl': 'radius-0',
    'rounded-4xl': 'radius-0',
    'rounded-full': 'radius-9999'  // Keep circles for avatars
  },
  
  // MIRA - Slightly smaller radii (-1 step)
  mira: {
    'rounded-xs': 'radius-2',
    'rounded-sm': 'radius-2',
    'rounded-md': 'radius-4',
    'rounded-lg': 'radius-6',
    'rounded-xl': 'radius-8',
    'rounded-2xl': 'radius-12',
    'rounded-3xl': 'radius-16',
    'rounded-4xl': 'radius-24',
    'rounded-full': 'radius-9999'
  }
};

// Semantic spacing mappings
var SPACING_THEMES = {
  // VEGA - Standard (baseline)
  vega: {
    '3xs': '1',    // 4px
    '2xs': '2',    // 8px
    'xs': '3',     // 12px
    'sm': '4',     // 16px
    'md': '5',     // 20px
    'lg': '6',     // 24px
    'xl': '8',     // 32px
    '2xl': '10',   // 40px
    '3xl': '12',   // 48px
    '4xl': '16',   // 64px
    '5xl': '20'    // 80px
  },
  
  // NOVA - Compact (-1 step)
  nova: {
    '3xs': '0.5',  // 2px
    '2xs': '1',    // 4px
    'xs': '2',     // 8px
    'sm': '3',     // 12px
    'md': '4',     // 16px
    'lg': '5',     // 20px
    'xl': '7',     // 28px
    '2xl': '9',    // 36px
    '3xl': '11',   // 44px
    '4xl': '14',   // 56px
    '5xl': '16'    // 64px
  },
  
  // MAIA - Generous (+1 step)
  maia: {
    '3xs': '2',    // 8px
    '2xs': '3',    // 12px
    'xs': '4',     // 16px
    'sm': '5',     // 20px
    'md': '6',     // 24px
    'lg': '7',     // 28px
    'xl': '9',     // 36px
    '2xl': '11',   // 44px
    '3xl': '14',   // 56px
    '4xl': '20',   // 80px
    '5xl': '24'    // 96px
  },
  
  // LYRA - Compact (same as Nova)
  lyra: {
    '3xs': '0.5',  // 2px
    '2xs': '1',    // 4px
    'xs': '2',     // 8px
    'sm': '3',     // 12px
    'md': '4',     // 16px
    'lg': '5',     // 20px
    'xl': '7',     // 28px
    '2xl': '9',    // 36px
    '3xl': '11',   // 44px
    '4xl': '14',   // 56px
    '5xl': '16'    // 64px
  },
  
  // MIRA - Most compact (-2 steps)
  mira: {
    '3xs': '0',    // 0px
    '2xs': '0.5',  // 2px
    'xs': '1',     // 4px
    'sm': '2',     // 8px
    'md': '3',     // 12px
    'lg': '4',     // 16px
    'xl': '6',     // 24px
    '2xl': '8',    // 32px
    '3xl': '10',   // 40px
    '4xl': '12',   // 48px
    '5xl': '14'    // 56px
  }
};

// Theme metadata for UI
var THEME_INFO = {
  vega: {
    name: 'Vega',
    description: 'Classic shadcn/ui look. Standard proportions and spacing.',
    characteristics: [
      'Button height: 36px (h-9)',
      'Border radius: rounded-md (6px)',
      'Standard spacing'
    ]
  },
  nova: {
    name: 'Nova',
    description: 'Compact and efficient. Tighter spacing, same radii.',
    characteristics: [
      'Button height: 32px (h-8)',
      'Border radius: rounded-lg (8px)',
      'Compact spacing (-1 step)'
    ]
  },
  maia: {
    name: 'Maia',
    description: 'Soft and rounded. Pill-shaped buttons, generous spacing.',
    characteristics: [
      'Button height: 36px (h-9)',
      'Border radius: pill (9999px)',
      'Generous spacing (+1 step)'
    ]
  },
  lyra: {
    name: 'Lyra',
    description: 'Boxy and sharp. Brutalist aesthetic with no border radius.',
    characteristics: [
      'Button height: 32px (h-8)',
      'Border radius: none (0px)',
      'Compact spacing, thin focus rings'
    ]
  },
  mira: {
    name: 'Mira',
    description: 'Dense and compact. Most space-efficient theme.',
    characteristics: [
      'Button height: 28px (h-7)',
      'Border radius: rounded-md (6px)',
      'Most compact spacing (-2 steps)'
    ]
  }
};

// ============================================================================
// FIGMA PLUGIN LOGIC
// ============================================================================

figma.showUI(__html__, { width: 340, height: 540 });

// Send theme info to UI on init
figma.ui.postMessage({
  type: 'init',
  themes: THEME_INFO
});

// Handle messages from UI
figma.ui.onmessage = function(msg) {
  if (msg.type === 'apply-theme') {
    applyTheme(msg.theme);
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

// Main function to apply a theme
function applyTheme(themeName) {
  var radiusMapping = RADIUS_THEMES[themeName];
  var spacingMapping = SPACING_THEMES[themeName];
  var componentData = COMPONENT_THEMES[themeName];
  
  if (!radiusMapping || !spacingMapping) {
    figma.ui.postMessage({ type: 'error', message: 'Unknown theme: ' + themeName });
    return;
  }
  
  figma.ui.postMessage({ type: 'status', message: 'Applying ' + THEME_INFO[themeName].name + ' theme...' });
  
  var results = {
    radiusUpdated: 0,
    spacingUpdated: 0,
    directUpdated: 0,
    errors: []
  };
  
  try {
    var collections = figma.variables.getLocalVariableCollections();
    
    for (var i = 0; i < collections.length; i++) {
      var collection = collections[i];
      var collectionName = collection.name.toLowerCase();
      
      // Update radius variables
      if (collectionName.indexOf('radius') !== -1 || 
          collectionName.indexOf('border') !== -1 ||
          collectionName.indexOf('rounded') !== -1) {
        var radiusResult = updateVariableCollection(collection, radiusMapping, RADIUS_VALUES, 'radius');
        results.radiusUpdated += radiusResult.updated;
        results.errors = results.errors.concat(radiusResult.errors);
      }
      
      // Update spacing variables
      if (collectionName.indexOf('spacing') !== -1 || 
          collectionName.indexOf('space') !== -1 ||
          collectionName.indexOf('size') !== -1) {
        var spacingResult = updateVariableCollection(collection, spacingMapping, SPACING_VALUES, 'spacing');
        results.spacingUpdated += spacingResult.updated;
        results.errors = results.errors.concat(spacingResult.errors);
      }
    }
    
    // Send results to UI
    var totalUpdated = results.radiusUpdated + results.spacingUpdated;
    
    if (results.errors.length > 0) {
      figma.ui.postMessage({
        type: 'warning',
        message: 'Theme applied with ' + results.errors.length + ' warning(s)',
        details: {
          radiusUpdated: results.radiusUpdated,
          spacingUpdated: results.spacingUpdated,
          errors: results.errors.slice(0, 5) // Show first 5 errors
        }
      });
    } else if (totalUpdated === 0) {
      figma.ui.postMessage({
        type: 'error',
        message: 'No matching variables found. Ensure your file has variable collections named "radius", "spacing", or similar with semantic tokens like "rounded-md", "spacing-sm", etc.'
      });
    } else {
      figma.ui.postMessage({
        type: 'success',
        message: THEME_INFO[themeName].name + ' theme applied!',
        details: {
          radiusUpdated: results.radiusUpdated,
          spacingUpdated: results.spacingUpdated
        }
      });
    }
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Error: ' + (error.message || 'Unknown error occurred')
    });
  }
}

// Update variables in a collection based on semantic mappings
function updateVariableCollection(collection, semanticMapping, absoluteValues, type) {
  var result = { updated: 0, errors: [] };
  var modeId = collection.modes[0].modeId;
  
  // Get all variables in this collection
  for (var v = 0; v < collection.variableIds.length; v++) {
    var variable = figma.variables.getVariableById(collection.variableIds[v]);
    if (!variable) continue;
    
    var varName = variable.name.toLowerCase().replace(/[\/_]/g, '-');
    
    // Try to match this variable to a semantic token
    for (var semanticToken in semanticMapping) {
      var tokenName = semanticToken.toLowerCase();
      
      // Check various naming patterns
      var isMatch = false;
      
      // Direct match: "rounded-md" === "rounded-md"
      if (varName === tokenName) {
        isMatch = true;
      }
      // Partial match: "border-radius-md" contains "rounded-md" or "md"
      else if (varName.indexOf(tokenName) !== -1) {
        isMatch = true;
      }
      // Size suffix match: "radius-md" ends with "-md"
      else if (tokenName.indexOf('-') !== -1) {
        var suffix = tokenName.split('-').pop();
        if (varName.endsWith('-' + suffix) || varName === suffix) {
          // Make sure it's the right type of suffix
          if (type === 'radius' && ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'full'].indexOf(suffix) !== -1) {
            isMatch = true;
          } else if (type === 'spacing' && ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'].indexOf(suffix) !== -1) {
            isMatch = true;
          }
        }
      }
      
      if (isMatch) {
        var targetAbsoluteName = semanticMapping[semanticToken];
        var pixelValue = absoluteValues[targetAbsoluteName];
        
        if (pixelValue !== undefined) {
          try {
            // First try to find and alias to an absolute variable
            var absoluteVar = findAbsoluteVariable(targetAbsoluteName, type);
            
            if (absoluteVar && absoluteVar.id !== variable.id) {
              // Set as alias
              variable.setValueForMode(modeId, {
                type: 'VARIABLE_ALIAS',
                id: absoluteVar.id
              });
              result.updated++;
            } else {
              // Set direct value
              variable.setValueForMode(modeId, pixelValue);
              result.updated++;
            }
          } catch (e) {
            // If alias fails, try direct value
            try {
              variable.setValueForMode(modeId, pixelValue);
              result.updated++;
            } catch (e2) {
              result.errors.push(variable.name + ': ' + e2.message);
            }
          }
        }
        break; // Found a match, move to next variable
      }
    }
  }
  
  return result;
}

// Find an absolute variable by name pattern
function findAbsoluteVariable(targetName, type) {
  var collections = figma.variables.getLocalVariableCollections();
  var targetLower = targetName.toLowerCase().replace(/[-_]/g, '');
  
  for (var c = 0; c < collections.length; c++) {
    var coll = collections[c];
    var collName = coll.name.toLowerCase();
    
    // Look in collections that might contain absolute values
    var isRelevant = false;
    if (type === 'radius' && (collName.indexOf('radius') !== -1 || collName.indexOf('absolute') !== -1 || collName.indexOf('primitive') !== -1)) {
      isRelevant = true;
    } else if (type === 'spacing' && (collName.indexOf('spacing') !== -1 || collName.indexOf('absolute') !== -1 || collName.indexOf('primitive') !== -1)) {
      isRelevant = true;
    }
    
    if (isRelevant) {
      for (var v = 0; v < coll.variableIds.length; v++) {
        var variable = figma.variables.getVariableById(coll.variableIds[v]);
        if (variable) {
          var varNameLower = variable.name.toLowerCase().replace(/[-_]/g, '');
          
          if (varNameLower === targetLower || 
              varNameLower.indexOf(targetLower) !== -1 ||
              varNameLower.endsWith(targetLower.replace('radius', ''))) {
            return variable;
          }
        }
      }
    }
  }
  
  return null;
}
