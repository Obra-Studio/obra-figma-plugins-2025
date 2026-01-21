// Chart Theme Switcher Plugin
// Applies predefined color palettes to shades/ variables

figma.showUI(__html__, { width: 300, height: 480 });

// Hardcoded color palettes extracted from design specs
// Format: { light: hex, dark: hex }
var PALETTES = {
  blue: {
    fill: { light: "BFDEFF", dark: "475D75" },
    stroke: { light: "8EC5FF", dark: "8EC5FF" },
    "fill 2": { light: "AACCFF", dark: "1F4176" },
    "stroke 2": { light: "3F8DFF", dark: "3F8DFF" }
  },
  orange: {
    fill: { light: "FDD09C", dark: "755738" },
    stroke: { light: "FFB86A", dark: "FFB86A" },
    "fill 2": { light: "F8B07E", dark: "76380E" },
    "stroke 2": { light: "FF6900", dark: "FF7915" }
  },
  green: {
    fill: { light: "B9FBD2", dark: "3F6E51" },
    stroke: { light: "7BF1AB", dark: "7BF1A8" },
    "fill 2": { light: "82E2A9", dark: "0E5E2E" },
    "stroke 2": { light: "19D163", dark: "19D163" }
  },
  rose: {
    fill: { light: "FFD9DE", dark: "754E53" },
    stroke: { light: "FFA1AD", dark: "FFA1AD" },
    "fill 2": { light: "F491A8", dark: "741B30" },
    "stroke 2": { light: "FF4F79", dark: "FF4670" }
  },
  teal: {
    fill: { light: "A9F4E8", dark: "409388" },
    stroke: { light: "46EDD5", dark: "46EDD5" },
    "fill 2": { light: "7CE7DC", dark: "0E5951" },
    "stroke 2": { light: "07C0AC", dark: "1CCFB9" }
  },
  purple: {
    fill: { light: "F0E0FF", dark: "655576" },
    stroke: { light: "DAB2FF", dark: "DAB2FF" },
    "fill 2": { light: "DEB5FF", dark: "532A77" },
    "stroke 2": { light: "C67EFF", dark: "A96ADD" }
  },
  amber: {
    fill: { light: "FFEDAC", dark: "746221" },
    stroke: { light: "FFD230", dark: "FFD230" },
    "fill 2": { light: "FED699", dark: "734B0E" },
    "stroke 2": { light: "FE9A00", dark: "FFA50A" }
  }
};

// Configuration - edit these to match your file setup
var CONFIG = {
  collectionName: "chart colors",
  targetGroup: "shades",
  lightModeName: "shadcn",
  darkModeName: "shadcn-dark",
  variableNames: ["fill", "stroke", "fill 2", "stroke 2"],
  opacity: 0.7 // 70% opacity
};

// Convert hex string to Figma RGBA with configured opacity
function hexToRgba(hex) {
  var r = parseInt(hex.slice(0, 2), 16) / 255;
  var g = parseInt(hex.slice(2, 4), 16) / 255;
  var b = parseInt(hex.slice(4, 6), 16) / 255;
  return { r: r, g: g, b: b, a: CONFIG.opacity };
}

// Send palette data to UI on init
function initialize() {
  var paletteData = [];
  var paletteNames = Object.keys(PALETTES);
  
  for (var i = 0; i < paletteNames.length; i++) {
    var name = paletteNames[i];
    var colors = PALETTES[name];
    paletteData.push({
      name: name,
      colors: {
        fill: { light: colors.fill.light, dark: colors.fill.dark },
        stroke: { light: colors.stroke.light, dark: colors.stroke.dark },
        "fill 2": { light: colors["fill 2"].light, dark: colors["fill 2"].dark },
        "stroke 2": { light: colors["stroke 2"].light, dark: colors["stroke 2"].dark }
      }
    });
  }
  
  figma.ui.postMessage({ type: "init", palettes: paletteData });
}

// Apply a palette to the shades variables
function applyPalette(paletteName) {
  var palette = PALETTES[paletteName];
  if (!palette) {
    return Promise.resolve({ success: false, message: 'Palette "' + paletteName + '" not found' });
  }

  return figma.variables.getLocalVariableCollectionsAsync().then(function(collections) {
    var collection = null;
    for (var i = 0; i < collections.length; i++) {
      if (collections[i].name.toLowerCase() === CONFIG.collectionName.toLowerCase()) {
        collection = collections[i];
        break;
      }
    }

    if (!collection) {
      return { success: false, message: 'Collection "' + CONFIG.collectionName + '" not found' };
    }

    // Find the modes
    var lightMode = null;
    var darkMode = null;
    for (var i = 0; i < collection.modes.length; i++) {
      var mode = collection.modes[i];
      if (mode.name.toLowerCase() === CONFIG.lightModeName.toLowerCase()) {
        lightMode = mode;
      }
      if (mode.name.toLowerCase() === CONFIG.darkModeName.toLowerCase()) {
        darkMode = mode;
      }
    }

    if (!lightMode || !darkMode) {
      return {
        success: false,
        message: 'Could not find modes "' + CONFIG.lightModeName + '" and/or "' + CONFIG.darkModeName + '"'
      };
    }

    return figma.variables.getLocalVariablesAsync("COLOR").then(function(variables) {
      var updatedCount = 0;
      var errors = [];

      for (var i = 0; i < CONFIG.variableNames.length; i++) {
        var varName = CONFIG.variableNames[i];
        var targetPath = CONFIG.targetGroup + "/" + varName;
        
        var variable = null;
        for (var j = 0; j < variables.length; j++) {
          if (variables[j].variableCollectionId === collection.id && variables[j].name === targetPath) {
            variable = variables[j];
            break;
          }
        }

        if (!variable) {
          errors.push('Variable "' + targetPath + '" not found');
          continue;
        }

        var colors = palette[varName];
        
        try {
          variable.setValueForMode(lightMode.modeId, hexToRgba(colors.light));
          variable.setValueForMode(darkMode.modeId, hexToRgba(colors.dark));
          updatedCount++;
        } catch (e) {
          errors.push('Failed to update "' + varName + '": ' + e);
        }
      }

      if (updatedCount === 0) {
        return { success: false, message: "No variables updated. " + errors.join(", ") };
      }

      if (errors.length > 0) {
        return {
          success: true,
          message: "Updated " + updatedCount + "/" + CONFIG.variableNames.length + " variables. Errors: " + errors.join(", ")
        };
      }

      return { success: true, message: 'Successfully applied "' + paletteName + '" theme!' };
    });
  });
}

// Handle messages from UI
figma.ui.onmessage = function(msg) {
  if (msg.type === "apply-palette") {
    applyPalette(msg.paletteName).then(function(result) {
      if (result.success) {
        figma.notify("✅ " + result.message);
      } else {
        figma.notify("❌ " + result.message, { error: true });
      }
      
      figma.ui.postMessage({ type: "apply-result", success: result.success, message: result.message });
    });
  }

  if (msg.type === "close") {
    figma.closePlugin();
  }
};

// Start
initialize();
