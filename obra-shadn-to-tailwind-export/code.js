// Figma Plugin: Variables to Tailwind/shadcn CSS
// Reads Figma variable collections and generates CSS with resolved values

// ============================================
// Color Conversion Functions
// ============================================

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbaToOklch(r, g, b, a) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l = Math.cbrt(l_);
  const m = Math.cbrt(m_);
  const s = Math.cbrt(s_);

  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

  const C = Math.sqrt(A * A + B * B);
  let H = Math.atan2(B, A) * (180 / Math.PI);
  if (H < 0) H += 360;

  return {
    l: Math.round(L * 1000) / 1000,
    c: Math.round(C * 1000) / 1000,
    h: Math.round(H * 1000) / 1000,
    a: a
  };
}

function formatOklch(oklch) {
  const chroma = oklch.c < 0.001 ? 0 : oklch.c;
  const hue = chroma === 0 ? 0 : oklch.h;
  
  if (oklch.a < 1) {
    return `oklch(${oklch.l} ${chroma} ${hue} / ${Math.round(oklch.a * 100)}%)`;
  }
  return `oklch(${oklch.l} ${chroma} ${hue})`;
}

// Convert pixels to rem (base 16px)
function pxToRem(px) {
  if (px === 0) return '0';
  return (px / 16) + 'rem';
}

// ============================================
// Variable Name Mapping
// ============================================

function getCssVariableName(figmaName) {
  const normalized = figmaName.toLowerCase().trim();
  const parts = normalized.split('/');
  const lastPart = parts[parts.length - 1].trim();
  
  // Shadow mappings - we need to collect all shadow parts
  // Return a structured key that we can parse later
  if (normalized.includes('shadows/')) {
    // Extract shadow size (2xs, xs, sm, md, lg, xl, 2xl)
    const shadowSizes = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'];
    for (const size of shadowSizes) {
      if (normalized.includes('shadows/' + size + '/') || normalized.includes('shadows/' + size)) {
        // Determine if it's a multi-shadow (has "shadow 1", "shadow 2")
        const hasShadowLayer = normalized.includes('shadow 1') || normalized.includes('shadow 2');
        const layer = normalized.includes('shadow 2') ? '2' : (hasShadowLayer ? '1' : '0');
        
        // Get the property (color, x, y, blur, spread)
        if (lastPart === 'color' || normalized.endsWith('/color')) {
          return `shadow-${size}-${layer}-color`;
        }
        if (lastPart === 'x' || lastPart === 'x2') {
          return `shadow-${size}-${layer}-x`;
        }
        if (lastPart === 'y') {
          return `shadow-${size}-${layer}-y`;
        }
        if (lastPart === 'blur') {
          return `shadow-${size}-${layer}-blur`;
        }
        if (lastPart === 'spread') {
          return `shadow-${size}-${layer}-spread`;
        }
      }
    }
  }
  
  // Spacing mappings (absolute values like spacing/absolute/1, spacing/absolute/2, etc.)
  if (normalized.includes('spacing') && normalized.includes('absolute')) {
    // Handle comma notation (0,5 -> 0.5) and regular numbers
    const spacingMatch = lastPart.replace(',', '.');
    // Return the spacing key (e.g., "0", "0.5", "1", "1.5", "2", etc.)
    if (!isNaN(parseFloat(spacingMatch))) {
      return 'spacing-' + spacingMatch;
    }
    if (lastPart === 'infinite') {
      return 'spacing-infinite';
    }
  }
  
  // Border radii mappings
  if (normalized.includes('border radi') || normalized.includes('rounded')) {
    // Semantic radius tokens
    if (lastPart === 'rounded-none') return 'radius-none';
    if (lastPart === 'rounded-xs') return 'radius-xs';
    if (lastPart === 'rounded-sm') return 'radius-sm';
    if (lastPart === 'rounded-md') return 'radius-md';
    if (lastPart === 'rounded-lg' || lastPart === 'radius') return 'radius-lg'; // This becomes the base --radius
    if (lastPart === 'rounded-xl') return 'radius-xl';
    if (lastPart === 'rounded-2xl') return 'radius-2xl';
    if (lastPart === 'rounded-3xl') return 'radius-3xl';
    if (lastPart === 'rounded-full') return 'radius-full';
  }
  
  // Font family mappings
  if (normalized.includes('font-family') || normalized.includes('font family')) {
    if (lastPart.includes('sans') || normalized.endsWith('sans')) return 'font-sans';
    if (lastPart.includes('serif') && !lastPart.includes('sans')) return 'font-serif';
    if (lastPart.includes('mono') || lastPart.includes('monospace')) return 'font-mono';
  }
  
  // Semantic colors
  if (normalized.includes('semantic colors') || normalized.includes('semantic-colors')) {
    // General colors - check for exact matches at the end
    if (parts.some(p => p === 'general')) {
      if (lastPart === 'background') return 'background';
      if (lastPart === 'foreground') return 'foreground';
      if (lastPart === 'primary') return 'primary';
      if (lastPart === 'primary foreground') return 'primary-foreground';
      if (lastPart === 'secondary') return 'secondary';
      if (lastPart === 'secondary foreground') return 'secondary-foreground';
      if (lastPart === 'muted') return 'muted';
      if (lastPart === 'muted foreground') return 'muted-foreground';
      if (lastPart === 'accent') return 'accent';
      if (lastPart === 'accent foreground') return 'accent-foreground';
      if (lastPart === 'destructive') return 'destructive';
      if (lastPart === 'destructive foreground') return 'destructive-foreground';
      if (lastPart === 'border') return 'border';
      if (lastPart === 'input') return 'input';
      if (lastPart === 'ring') return 'ring';
    }
    
    // Card
    if (parts.some(p => p === 'card')) {
      if (lastPart === 'card') return 'card';
      if (lastPart === 'card foreground') return 'card-foreground';
    }
    
    // Popover
    if (parts.some(p => p === 'popover')) {
      if (lastPart === 'popover') return 'popover';
      if (lastPart === 'popover foreground') return 'popover-foreground';
    }
    
    // Sidebar
    if (parts.some(p => p === 'sidebar')) {
      if (lastPart === 'sidebar') return 'sidebar';
      if (lastPart === 'sidebar foreground') return 'sidebar-foreground';
      if (lastPart === 'sidebar border') return 'sidebar-border';
      if (lastPart === 'sidebar ring') return 'sidebar-ring';
      if (lastPart === 'sidebar primary') return 'sidebar-primary';
      if (lastPart === 'sidebar primary foreground') return 'sidebar-primary-foreground';
      if (lastPart === 'sidebar accent') return 'sidebar-accent';
      if (lastPart === 'sidebar accent foreground') return 'sidebar-accent-foreground';
    }
  }
  
  // Chart colors - look in chart/legacy path
  if (normalized.includes('chart')) {
    // Match "chart 1", "chart 2", etc. or just "1", "2", etc.
    const chartMatch = lastPart.match(/chart\s*(\d+)/);
    if (chartMatch) return `chart-${chartMatch[1]}`;
    // Also match standalone numbers like "1", "2", etc.
    if (/^\d+$/.test(lastPart)) return `chart-${lastPart}`;
  }
  
  return null;
}

// ============================================
// Variable Resolution
// ============================================

async function resolveVariableValue(variableValue, modeId, visited = new Set()) {
  // Direct RGBA value
  if (variableValue && typeof variableValue === 'object' && 'r' in variableValue) {
    return variableValue;
  }
  
  // Number (for float variables)
  if (typeof variableValue === 'number') {
    return variableValue;
  }
  
  // String (for font family variables)
  if (typeof variableValue === 'string') {
    return variableValue;
  }
  
  // Variable alias - resolve it
  if (variableValue && typeof variableValue === 'object' && variableValue.type === 'VARIABLE_ALIAS') {
    const aliasId = variableValue.id;
    
    if (visited.has(aliasId)) {
      console.warn('Circular variable reference:', aliasId);
      return null;
    }
    visited.add(aliasId);
    
    const referencedVariable = await figma.variables.getVariableByIdAsync(aliasId);
    if (!referencedVariable) {
      console.warn('Variable not found:', aliasId);
      return null;
    }
    
    let value = referencedVariable.valuesByMode[modeId];
    
    // Fallback to default mode if not found
    if (value === undefined) {
      const collection = await figma.variables.getVariableCollectionByIdAsync(referencedVariable.variableCollectionId);
      if (collection) {
        value = referencedVariable.valuesByMode[collection.defaultModeId];
      }
    }
    
    return await resolveVariableValue(value, modeId, visited);
  }
  
  return variableValue;
}

// ============================================
// Data Collection
// ============================================

async function collectVariableData() {
  const collections = [];
  
  try {
    const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
    
    for (const collection of localCollections) {
      const modes = collection.modes.map(mode => ({
        modeId: mode.modeId,
        name: mode.name
      }));
      
      const variables = [];
      
      for (const variableId of collection.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (variable) {
          variables.push({
            id: variable.id,
            name: variable.name,
            resolvedType: variable.resolvedType,
            valuesByMode: variable.valuesByMode
          });
        }
      }
      
      collections.push({
        id: collection.id,
        name: collection.name,
        modes: modes,
        defaultModeId: collection.defaultModeId,
        variables: variables
      });
    }
  } catch (error) {
    console.error('Error collecting variables:', error);
  }
  
  return collections;
}

// ============================================
// Shadow Building
// ============================================

function buildShadowVariables(shadowParts) {
  const shadows = new Map();
  const sizes = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'];
  
  for (const size of sizes) {
    const shadowLayers = [];
    
    // Check for multi-layer shadows (layer 1 and 2) or single layer (layer 0)
    for (const layer of ['0', '1', '2']) {
      const prefix = `shadow-${size}-${layer}`;
      
      // Get shadow components
      const x = shadowParts.get(`${prefix}-x`);
      const y = shadowParts.get(`${prefix}-y`);
      const blur = shadowParts.get(`${prefix}-blur`);
      const spread = shadowParts.get(`${prefix}-spread`);
      const color = shadowParts.get(`${prefix}-color`);
      
      // If we have at least x, y, and color, we can build a shadow
      if (x !== undefined && y !== undefined) {
        // Use the color from this layer, or fall back to the main shadow color
        let shadowColor = color;
        if (!shadowColor) {
          // Try to get color from layer 0 (main color) or layer 1
          shadowColor = shadowParts.get(`shadow-${size}-0-color`) || 
                        shadowParts.get(`shadow-${size}-1-color`);
        }
        
        if (shadowColor) {
          const colorStr = formatRgba(shadowColor);
          const blurVal = blur !== undefined ? blur : 0;
          const spreadVal = spread !== undefined ? spread : 0;
          
          shadowLayers.push(`${x}px ${y}px ${blurVal}px ${spreadVal}px ${colorStr}`);
        }
      }
    }
    
    if (shadowLayers.length > 0) {
      shadows.set(`shadow-${size}`, shadowLayers.join(', '));
    }
  }
  
  return shadows;
}

// Format RGBA color for shadow (rgb(r g b / a) format)
function formatRgba(color) {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a !== undefined ? color.a : 1;
  
  if (a < 1) {
    return `rgb(${r} ${g} ${b} / ${a.toFixed(2)})`;
  }
  return `rgb(${r} ${g} ${b})`;
}

// ============================================
// CSS Generation
// ============================================

async function generateStylesheet(collection, modeId, modeName) {
  const cssVariables = new Map();
  const radiusVariables = new Map();
  const spacingVariables = new Map();
  const shadowParts = new Map(); // Store shadow component parts
  
  for (const variable of collection.variables) {
    const cssName = getCssVariableName(variable.name);
    if (!cssName) continue;
    
    const rawValue = variable.valuesByMode[modeId];
    if (rawValue === undefined || rawValue === null) continue;
    
    const resolvedValue = await resolveVariableValue(rawValue, modeId);
    if (resolvedValue === null || resolvedValue === undefined) continue;
    
    // COLOR type
    if (variable.resolvedType === 'COLOR' && typeof resolvedValue === 'object' && 'r' in resolvedValue) {
      // Check if it's a shadow color
      if (cssName.startsWith('shadow-') && cssName.endsWith('-color')) {
        shadowParts.set(cssName, resolvedValue);
      } else {
        const oklch = rgbaToOklch(
          resolvedValue.r,
          resolvedValue.g,
          resolvedValue.b,
          resolvedValue.a !== undefined ? resolvedValue.a : 1
        );
        cssVariables.set(cssName, formatOklch(oklch));
      }
    }
    // FLOAT type (radii, spacing, and shadow dimensions)
    else if (variable.resolvedType === 'FLOAT' && typeof resolvedValue === 'number') {
      if (cssName.startsWith('radius-')) {
        radiusVariables.set(cssName, resolvedValue);
      } else if (cssName.startsWith('spacing-')) {
        spacingVariables.set(cssName, resolvedValue);
      } else if (cssName.startsWith('shadow-')) {
        // Shadow x, y, blur, spread values
        shadowParts.set(cssName, resolvedValue);
      }
    }
    // STRING type (font families)
    else if (variable.resolvedType === 'STRING' && typeof resolvedValue === 'string') {
      if (cssName.startsWith('font-')) {
        const fontValue = formatFontFamily(resolvedValue, cssName);
        cssVariables.set(cssName, fontValue);
      }
    }
  }
  
  // Build shadow CSS values from collected parts
  const shadowVariables = buildShadowVariables(shadowParts);
  
  // Build CSS output
  let css = ':root {\n';
  
  // Legacy --radius for shadcn compatibility (uses radius-lg value)
  if (radiusVariables.has('radius-lg')) {
    css += '  --radius: ' + pxToRem(radiusVariables.get('radius-lg')) + ';\n';
  } else {
    css += '  --radius: 0.5rem;\n';
  }
  
  // Colors in order
  const colorKeys = [
    'background', 'foreground',
    'card', 'card-foreground',
    'popover', 'popover-foreground',
    'primary', 'primary-foreground',
    'secondary', 'secondary-foreground',
    'muted', 'muted-foreground',
    'accent', 'accent-foreground',
    'destructive', 'destructive-foreground',
    'border', 'input', 'ring',
    'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
    'sidebar', 'sidebar-foreground',
    'sidebar-primary', 'sidebar-primary-foreground',
    'sidebar-accent', 'sidebar-accent-foreground',
    'sidebar-border', 'sidebar-ring'
  ];
  
  for (const key of colorKeys) {
    if (cssVariables.has(key)) {
      css += '  --' + key + ': ' + cssVariables.get(key) + ';\n';
    }
  }
  
  css += '}\n';
  
  // @theme inline block for Tailwind v4
  css += '\n@theme inline {\n';
  
  // Color mappings
  css += '  --color-background: var(--background);\n';
  css += '  --color-foreground: var(--foreground);\n';
  css += '  --color-card: var(--card);\n';
  css += '  --color-card-foreground: var(--card-foreground);\n';
  css += '  --color-popover: var(--popover);\n';
  css += '  --color-popover-foreground: var(--popover-foreground);\n';
  css += '  --color-primary: var(--primary);\n';
  css += '  --color-primary-foreground: var(--primary-foreground);\n';
  css += '  --color-secondary: var(--secondary);\n';
  css += '  --color-secondary-foreground: var(--secondary-foreground);\n';
  css += '  --color-muted: var(--muted);\n';
  css += '  --color-muted-foreground: var(--muted-foreground);\n';
  css += '  --color-accent: var(--accent);\n';
  css += '  --color-accent-foreground: var(--accent-foreground);\n';
  css += '  --color-destructive: var(--destructive);\n';
  css += '  --color-destructive-foreground: var(--destructive-foreground);\n';
  css += '  --color-border: var(--border);\n';
  css += '  --color-input: var(--input);\n';
  css += '  --color-ring: var(--ring);\n';
  css += '  --color-chart-1: var(--chart-1);\n';
  css += '  --color-chart-2: var(--chart-2);\n';
  css += '  --color-chart-3: var(--chart-3);\n';
  css += '  --color-chart-4: var(--chart-4);\n';
  css += '  --color-chart-5: var(--chart-5);\n';
  css += '  --color-sidebar: var(--sidebar);\n';
  css += '  --color-sidebar-foreground: var(--sidebar-foreground);\n';
  css += '  --color-sidebar-primary: var(--sidebar-primary);\n';
  css += '  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);\n';
  css += '  --color-sidebar-accent: var(--sidebar-accent);\n';
  css += '  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);\n';
  css += '  --color-sidebar-border: var(--sidebar-border);\n';
  css += '  --color-sidebar-ring: var(--sidebar-ring);\n\n';
  
  // Font families
  if (cssVariables.has('font-sans')) {
    css += '  --font-sans: ' + cssVariables.get('font-sans') + ';\n';
  } else {
    css += '  --font-sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";\n';
  }
  
  if (cssVariables.has('font-mono')) {
    css += '  --font-mono: ' + cssVariables.get('font-mono') + ';\n';
  } else {
    css += '  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;\n';
  }
  
  if (cssVariables.has('font-serif')) {
    css += '  --font-serif: ' + cssVariables.get('font-serif') + ';\n';
  } else {
    css += '  --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;\n';
  }
  
  css += '\n';
  
  // Radius theme variables for Tailwind v4
  // These map directly to rounded-* utility classes
  // Order: xs, sm, md, lg, xl, 2xl, 3xl, 4xl (Tailwind v4 default scale)
  if (radiusVariables.has('radius-xs')) {
    css += '  --radius-xs: ' + pxToRem(radiusVariables.get('radius-xs')) + ';\n';
  } else {
    css += '  --radius-xs: 0.125rem;\n';
  }
  
  if (radiusVariables.has('radius-sm')) {
    css += '  --radius-sm: ' + pxToRem(radiusVariables.get('radius-sm')) + ';\n';
  } else {
    css += '  --radius-sm: 0.25rem;\n';
  }
  
  if (radiusVariables.has('radius-md')) {
    css += '  --radius-md: ' + pxToRem(radiusVariables.get('radius-md')) + ';\n';
  } else {
    css += '  --radius-md: 0.375rem;\n';
  }
  
  if (radiusVariables.has('radius-lg')) {
    css += '  --radius-lg: ' + pxToRem(radiusVariables.get('radius-lg')) + ';\n';
  } else {
    css += '  --radius-lg: 0.5rem;\n';
  }
  
  if (radiusVariables.has('radius-xl')) {
    css += '  --radius-xl: ' + pxToRem(radiusVariables.get('radius-xl')) + ';\n';
  } else {
    css += '  --radius-xl: 0.75rem;\n';
  }
  
  if (radiusVariables.has('radius-2xl')) {
    css += '  --radius-2xl: ' + pxToRem(radiusVariables.get('radius-2xl')) + ';\n';
  } else {
    css += '  --radius-2xl: 1rem;\n';
  }
  
  if (radiusVariables.has('radius-3xl')) {
    css += '  --radius-3xl: ' + pxToRem(radiusVariables.get('radius-3xl')) + ';\n';
  } else {
    css += '  --radius-3xl: 1.5rem;\n';
  }
  
  // 4xl is in Tailwind v4 defaults but may not be in Figma
  if (radiusVariables.has('radius-4xl')) {
    css += '  --radius-4xl: ' + pxToRem(radiusVariables.get('radius-4xl')) + ';\n';
  } else {
    css += '  --radius-4xl: 2rem;\n';
  }
  
  css += '\n';
  
  // Spacing theme variable for Tailwind v4
  // Tailwind v4 uses a single --spacing base value (default 0.25rem = 4px)
  // Utilities like p-4, m-8 are calculated as multiples: p-4 = 4 * --spacing = 1rem
  // We derive the base from spacing-1 (which should be 4px in standard Tailwind scale)
  if (spacingVariables.has('spacing-1')) {
    const baseSpacing = spacingVariables.get('spacing-1'); // Should be 4 in px
    css += '  --spacing: ' + pxToRem(baseSpacing) + ';\n';
  } else {
    css += '  --spacing: 0.25rem;\n';
  }
  
  css += '\n';
  
  // Shadow theme variables for Tailwind v4
  // These map to shadow-* utility classes
  const defaultShadows = {
    'shadow-2xs': '0 1px rgb(0 0 0 / 0.05)',
    'shadow-xs': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    'shadow-sm': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    'shadow-md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    'shadow-lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    'shadow-xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    'shadow-2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)'
  };
  
  for (const [key, defaultValue] of Object.entries(defaultShadows)) {
    if (shadowVariables.has(key)) {
      css += '  --' + key + ': ' + shadowVariables.get(key) + ';\n';
    } else {
      css += '  --' + key + ': ' + defaultValue + ';\n';
    }
  }
  
  css += '}\n';
  
  return css;
}

// Format font family with appropriate fallbacks
function formatFontFamily(fontName, cssName) {
  const quotedFont = fontName.includes(' ') ? `"${fontName}"` : fontName;
  
  if (cssName === 'font-mono') {
    return `${quotedFont}, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
  } else if (cssName === 'font-serif') {
    return `${quotedFont}, ui-serif, Georgia, Cambria, "Times New Roman", Times, serif`;
  } else {
    return `${quotedFont}, ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`;
  }
}

// ============================================
// Plugin Initialization
// ============================================

figma.showUI(__html__, { width: 480, height: 600, themeColors: true });

collectVariableData().then(collections => {
  figma.ui.postMessage({
    type: 'collections-loaded',
    collections: collections.map(c => ({
      id: c.id,
      name: c.name,
      modes: c.modes
    }))
  });
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'generate-stylesheet') {
    const { collectionId, modeId, modeName } = msg;
    
    const collections = await collectVariableData();
    const collection = collections.find(c => c.id === collectionId);
    
    if (collection) {
      try {
        const stylesheet = await generateStylesheet(collection, modeId, modeName);
        figma.ui.postMessage({
          type: 'stylesheet-generated',
          stylesheet: stylesheet,
          modeName: modeName
        });
      } catch (error) {
        console.error('Error generating stylesheet:', error);
        figma.ui.postMessage({
          type: 'error',
          message: 'Failed to generate stylesheet: ' + error.message
        });
      }
    } else {
      figma.ui.postMessage({
        type: 'error',
        message: 'Collection not found'
      });
    }
  }
  
  if (msg.type === 'close') {
    figma.closePlugin();
  }
};
