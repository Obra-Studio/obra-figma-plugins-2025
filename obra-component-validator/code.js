// Figma Plugin Main Code (code.js)

// Configuration - Made more strict to catch real problems
var CONFIG = {
  gridCompletenessThreshold: 0.75, // Lowered from 0.8 - be more strict
  maxOrphanedProperties: 0, // Zero tolerance - any orphaned property is a problem
  ignoreProperties: ['instanceSwap'], // Figma-specific properties to ignore
  autoFixSuggestions: true
};

// Main plugin logic
figma.showUI(__html__, {
  width: 400,
  height: 600,
  title: "Component Variant Validator"
});

// Handle messages from UI
figma.ui.onmessage = function(msg) {
  if (msg.type === 'scan-current-page') {
    scanCurrentPage().then(function(results) {
      figma.ui.postMessage({ type: 'scan-results', data: results });
    });
  } else if (msg.type === 'scan-all-pages') {
    scanAllPages().then(function(allResults) {
      figma.ui.postMessage({ type: 'scan-results', data: allResults });
    });
  } else if (msg.type === 'focus-component') {
    var component = figma.getNodeById(msg.id);
    if (component) {
      figma.currentPage.selection = [component];
      figma.viewport.scrollAndZoomIntoView([component]);
    }
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};

// Core analysis functions
function extractProperties(variants) {
  console.log('\n--- EXTRACTING PROPERTIES ---');
  console.log('Input variants count:', variants.length);

  var properties = {};

  for (var i = 0; i < variants.length; i++) {
    var variant = variants[i];
    var variantProps = variant.variantProperties || {};

    console.log('Processing variant', (i + 1) + ':', variant.name);
    console.log('  Raw variantProperties:', variantProps);

    if (Object.keys(variantProps).length === 0) {
      console.log('  WARNING: Variant has no properties!');
      continue;
    }

    for (var key in variantProps) {
      if (variantProps.hasOwnProperty(key)) {
        if (CONFIG.ignoreProperties.indexOf(key) !== -1) {
          console.log('  Ignoring property:', key, '(in ignore list)');
          continue;
        }

        if (!properties[key]) {
          properties[key] = [];
          console.log('  New property discovered:', key);
        }

        var value = variantProps[key];
        // Normalize the value (trim whitespace, handle different types)
        if (typeof value === 'string') {
          value = value.trim();
        }

        if (properties[key].indexOf(value) === -1) {
          properties[key].push(value);
          console.log('    Added value "' + value + '" to property "' + key + '"');
        } else {
          console.log('    Value "' + value + '" already exists for property "' + key + '"');
        }
      }
    }
  }

  console.log('--- PROPERTY EXTRACTION COMPLETE ---');
  console.log('Final properties object:', properties);

  var totalValues = 0;
  for (var prop in properties) {
    if (properties.hasOwnProperty(prop)) {
      totalValues += properties[prop].length;
      console.log('Property "' + prop + '": ' + properties[prop].length + ' unique values [' + properties[prop].join(', ') + ']');
    }
  }
  console.log('Total unique property-value pairs:', totalValues);

  return properties;
}

function cartesianProduct(properties) {
  console.log('\n--- CALCULATING CARTESIAN PRODUCT ---');

  var keys = Object.keys(properties);
  if (keys.length === 0) {
    console.log('No properties provided - returning empty array');
    return [];
  }

  console.log('Properties to combine:', keys.length);
  for (var i = 0; i < keys.length; i++) {
    console.log('  ' + keys[i] + ': ' + properties[keys[i]].length + ' values');
  }

  var result = [];
  var values = keys.map(function(key) { return properties[key]; });

  // Calculate total expected combinations
  var totalExpected = 1;
  for (var i = 0; i < values.length; i++) {
    totalExpected *= values[i].length;
  }
  console.log('Expected total combinations:', totalExpected);

  function generateCombinations(index, current) {
    if (index === keys.length) {
      var combo = {};
      for (var k in current) {
        if (current.hasOwnProperty(k)) {
          combo[k] = current[k];
        }
      }
      result.push(combo);
      return;
    }

    var currentValues = values[index];
    for (var i = 0; i < currentValues.length; i++) {
      current[keys[index]] = currentValues[i];
      generateCombinations(index + 1, current);
    }
  }

  generateCombinations(0, {});

  console.log('Generated', result.length, 'combinations (expected', totalExpected + ')');
  if (result.length !== totalExpected) {
    console.log('ERROR: Mismatch in expected vs generated combinations!');
  }

  return result;
}

function findMissingCombinations(expected, actual) {
  console.log('\n--- FINDING MISSING COMBINATIONS ---');
  console.log('Expected combinations:', expected.length);
  console.log('Actual combinations:', actual.length);

  // Convert actual combinations to string set for fast lookup
  var actualSet = [];
  console.log('Converting actual combinations to strings:');
  for (var i = 0; i < actual.length; i++) {
    var str = JSON.stringify(actual[i]);
    actualSet.push(str);
    console.log('  ' + (i + 1) + ': ' + str);
  }

  var missing = [];
  console.log('Checking each expected combination:');
  for (var i = 0; i < expected.length; i++) {
    var expectedStr = JSON.stringify(expected[i]);
    var found = actualSet.indexOf(expectedStr) !== -1;

    if (!found) {
      missing.push(expected[i]);
      console.log('  MISSING: ' + expectedStr);
    } else {
      console.log('  Found: ' + expectedStr);
    }
  }

  console.log('Total missing combinations:', missing.length);
  return missing;
}

function findOrphanedProperties(properties, actualCombinations) {
  var orphaned = {};

  console.log('Analyzing orphaned properties...');
  console.log('Properties:', properties);
  console.log('Actual combinations:', actualCombinations);

  for (var prop in properties) {
    if (!properties.hasOwnProperty(prop)) continue;

    var values = properties[prop];

    for (var i = 0; i < values.length; i++) {
      var value = values[i];
      var combinations = [];

      // Find all combinations that use this property value
      for (var j = 0; j < actualCombinations.length; j++) {
        if (actualCombinations[j][prop] === value) {
          combinations.push(actualCombinations[j]);
        }
      }

      if (combinations.length === 0) continue;

      console.log('Property', prop + '=' + value, 'appears in', combinations.length, 'combinations');

      // Check if this value only appears with specific other values
      var otherProps = Object.keys(properties).filter(function(p) { return p !== prop; });
      var restrictions = findRestrictions(combinations, otherProps);

      console.log('Restrictions for', prop + '=' + value + ':', restrictions);

      // A property is orphaned if:
      // 1. It has restrictions AND
      // 2. The restrictions are not universal (doesn't appear in ALL combinations)
      if (restrictions.length > 0) {
        var totalCombinationsForOtherProps = 1;
        for (var k = 0; k < otherProps.length; k++) {
          totalCombinationsForOtherProps *= properties[otherProps[k]].length;
        }

        // If this property value appears in fewer combinations than should be possible
        // with the other properties, it's restricted/orphaned
        if (combinations.length < totalCombinationsForOtherProps / values.length) {
          orphaned[prop + '=' + value] = restrictions;
          console.log('ORPHANED:', prop + '=' + value, 'restricted to:', restrictions);
        }
      }
    }
  }

  return orphaned;
}

function findRestrictions(combinations, otherProps) {
  var restrictions = [];

  for (var i = 0; i < otherProps.length; i++) {
    var prop = otherProps[i];
    var uniqueValues = [];

    for (var j = 0; j < combinations.length; j++) {
      var val = combinations[j][prop];
      if (val !== undefined && uniqueValues.indexOf(val) === -1) {
        uniqueValues.push(val);
      }
    }

    // If this property only has one unique value across all combinations,
    // it's a restriction
    if (uniqueValues.length === 1) {
      restrictions.push(prop + '=' + uniqueValues[0]);
    }
    // If this property is missing from some combinations, that's also a restriction
    else if (uniqueValues.length < combinations.length) {
      // Some combinations don't have this property - this indicates conditional usage
      restrictions.push(prop + '=conditional');
    }
  }

  return restrictions;
}

function analyzeComponent(component) {
  console.log('\n=== ANALYZING COMPONENT:', component.name, '===');
  console.log('Component type:', component.type);

  // According to Figma API, COMPONENT_SET contains COMPONENT children
  // We need to get variants from the children, not from a .variants property
  var variants = [];

  if (component.type === 'COMPONENT_SET') {
    console.log('Processing COMPONENT_SET with', component.children.length, 'children');

    // Each child should be a COMPONENT with variantProperties
    for (var i = 0; i < component.children.length; i++) {
      var child = component.children[i];
      console.log('  Child', i + ':', child.name, 'Type:', child.type);

      if (child.type === 'COMPONENT') {
        console.log('    This is a COMPONENT variant');
        console.log('    variantProperties:', child.variantProperties);
        variants.push(child);
      } else {
        console.log('    WARNING: Expected COMPONENT, got', child.type);
      }
    }
  } else if (component.variants) {
    // Fallback: if there's a direct .variants property (older API?)
    console.log('Using direct .variants property');
    variants = component.variants;
  } else {
    console.log('ERROR: Cannot find variants in component');
    return null;
  }

  if (variants.length === 0) {
    console.log('Component', component.name, 'has no variants - skipping');
    return null;
  }

  console.log('Found', variants.length, 'variants to analyze');

  // Log each variant's properties in detail
  console.log('Variant breakdown:');
  for (var i = 0; i < variants.length; i++) {
    var variant = variants[i];
    console.log('  Variant ' + (i + 1) + ': "' + variant.name + '"');
    console.log('    Type:', variant.type);
    console.log('    Raw variantProperties:', variant.variantProperties);

    // Check if variantProperties exists and has content
    if (!variant.variantProperties) {
      console.log('    WARNING: No variantProperties found for this variant!');
    } else {
      var propCount = Object.keys(variant.variantProperties).length;
      console.log('    Property count:', propCount);
      for (var key in variant.variantProperties) {
        if (variant.variantProperties.hasOwnProperty(key)) {
          console.log('      ' + key + ': "' + variant.variantProperties[key] + '"');
        }
      }
    }
  }

  var properties = extractProperties(variants);

  if (Object.keys(properties).length === 0) {
    console.log('ERROR: No properties extracted from', component.name);
    return null;
  }

  console.log('Extracted properties summary:');
  for (var prop in properties) {
    if (properties.hasOwnProperty(prop)) {
      console.log('  ' + prop + ': [' + properties[prop].join(', ') + '] (' + properties[prop].length + ' values)');
    }
  }

  var expectedCombinations = cartesianProduct(properties);
  console.log('Expected combinations (cartesian product):', expectedCombinations.length);

  // Show first few expected combinations for verification
  console.log('First few expected combinations:');
  for (var i = 0; i < Math.min(5, expectedCombinations.length); i++) {
    var combo = expectedCombinations[i];
    var comboStr = [];
    for (var key in combo) {
      if (combo.hasOwnProperty(key)) {
        comboStr.push(key + '=' + combo[key]);
      }
    }
    console.log('  ' + (i + 1) + ': {' + comboStr.join(', ') + '}');
  }

  var actualCombinations = [];

  for (var i = 0; i < variants.length; i++) {
    var combo = variants[i].variantProperties || {};
    // Normalize combination values
    var normalizedCombo = {};
    for (var key in combo) {
      if (combo.hasOwnProperty(key)) {
        var value = combo[key];
        if (typeof value === 'string') {
          value = value.trim();
        }
        normalizedCombo[key] = value;
      }
    }
    actualCombinations.push(normalizedCombo);
  }

  console.log('Actual combinations:', actualCombinations.length);
  console.log('Actual combination details:');
  for (var i = 0; i < actualCombinations.length; i++) {
    var combo = actualCombinations[i];
    var comboStr = [];
    for (var key in combo) {
      if (combo.hasOwnProperty(key)) {
        comboStr.push(key + '=' + combo[key]);
      }
    }
    console.log('  ' + (i + 1) + ': {' + comboStr.join(', ') + '}');
  }

  var missingCombinations = findMissingCombinations(expectedCombinations, actualCombinations);
  var orphanedProperties = findOrphanedProperties(properties, actualCombinations);
  var gridCompleteness = expectedCombinations.length > 0 ? actualCombinations.length / expectedCombinations.length : 0;

  console.log('\n--- ANALYSIS RESULTS for', component.name, '---');
  console.log('Properties found:', Object.keys(properties).length);
  console.log('Expected combinations:', expectedCombinations.length);
  console.log('Actual combinations:', actualCombinations.length);
  console.log('Grid completeness:', Math.round(gridCompleteness * 100) + '%');
  console.log('Missing combinations:', missingCombinations.length);
  console.log('Orphaned properties:', Object.keys(orphanedProperties).length);

  if (missingCombinations.length > 0) {
    console.log('Missing combinations (first 5):');
    for (var i = 0; i < Math.min(5, missingCombinations.length); i++) {
      var combo = missingCombinations[i];
      var comboStr = [];
      for (var key in combo) {
        if (combo.hasOwnProperty(key)) {
          comboStr.push(key + '=' + combo[key]);
        }
      }
      console.log('  Missing: {' + comboStr.join(', ') + '}');
    }
  }

  if (Object.keys(orphanedProperties).length > 0) {
    console.log('Orphaned properties details:');
    for (var prop in orphanedProperties) {
      if (orphanedProperties.hasOwnProperty(prop)) {
        console.log('  ' + prop + ' → restrictions: [' + orphanedProperties[prop].join(', ') + ']');
      }
    }
  }

  return {
    properties: properties,
    expectedCombinations: expectedCombinations,
    actualCombinations: actualCombinations,
    missingCombinations: missingCombinations,
    orphanedProperties: orphanedProperties,
    gridCompleteness: gridCompleteness
  };
}

function categorizeIssues(analysis, componentName) {
  var issues = [];

  console.log('Categorizing issues for', componentName);
  console.log('Grid completeness:', analysis.gridCompleteness);
  console.log('Orphaned properties count:', Object.keys(analysis.orphanedProperties).length);

  // Sparse grid detection - be more aggressive about catching sparse grids
  if (analysis.gridCompleteness < CONFIG.gridCompletenessThreshold) {
    var severity = "medium";
    if (analysis.gridCompleteness < 0.5) {
      severity = "high";
    } else if (analysis.gridCompleteness < 0.3) {
      severity = "high";
    }

    issues.push({
      type: "sparse_grid",
      severity: severity,
      message: "Only " + Math.round(analysis.gridCompleteness * 100) + "% of possible combinations exist (" + analysis.actualCombinations.length + "/" + analysis.expectedCombinations.length + "). This suggests the component tries to do too many things."
    });
  }

  // Orphaned properties - be more specific about the problems
  for (var propValue in analysis.orphanedProperties) {
    if (analysis.orphanedProperties.hasOwnProperty(propValue)) {
      var restrictions = analysis.orphanedProperties[propValue];
      issues.push({
        type: "orphaned_property",
        severity: "high", // Elevated from medium - this is an architectural problem
        property: propValue,
        restrictions: restrictions,
        message: "'" + propValue + "' only works with: " + restrictions.join(', ') + ". This breaks orthogonal design principles."
      });
    }
  }

  // Too many missing combinations - lower threshold
  if (analysis.missingCombinations.length > 5) { // Lowered from 10
    issues.push({
      type: "excessive_missing",
      severity: "high",
      message: analysis.missingCombinations.length + " combinations missing. Component logic is too complex - consider splitting."
    });
  }

  // New detection: Too many properties
  var propertyCount = Object.keys(analysis.properties).length;
  if (propertyCount > 3) { // More strict threshold
    issues.push({
      type: "too_many_properties",
      severity: "medium",
      message: propertyCount + " variant properties is complex. Consider if all properties are truly orthogonal."
    });
  }

  // New detection: Inconsistent property usage
  var totalPossibleCombinations = 1;
  for (var prop in analysis.properties) {
    if (analysis.properties.hasOwnProperty(prop)) {
      totalPossibleCombinations *= analysis.properties[prop].length;
    }
  }

  // If we have way fewer actual combinations than theoretical, something's wrong
  if (totalPossibleCombinations > 8 && analysis.gridCompleteness < 0.4) {
    issues.push({
      type: "architectural_complexity",
      severity: "high",
      message: "Component has " + totalPossibleCombinations + " possible states but only " + analysis.actualCombinations.length + " implemented. This indicates architectural problems."
    });
  }

  console.log('Found', issues.length, 'issues for', componentName);
  return issues;
}

function generateSuggestions(analysis, componentName) {
  var suggestions = [];
  var orphanedCount = Object.keys(analysis.orphanedProperties).length;
  var propertyCount = Object.keys(analysis.properties).length;

  // More aggressive suggestions for component splitting
  if (orphanedCount > 0) { // Any orphaned properties suggest splitting
    suggestions.push({
      type: "split_component",
      message: "Split component to resolve orthogonality violations",
      recommendation: "'" + componentName + "' has properties that don't work independently. Split into focused components."
    });
  }

  // Suggest splitting based on grid completeness
  if (analysis.gridCompleteness < 0.5) {
    suggestions.push({
      type: "split_component",
      message: "Low grid completeness suggests multiple concepts",
      recommendation: "Only " + Math.round(analysis.gridCompleteness * 100) + "% of combinations exist - likely mixing different use cases."
    });
  }

  // Suggest missing variants (if reasonable number)
  if (analysis.missingCombinations.length > 0 && analysis.missingCombinations.length <= 3) {
    var variantExamples = [];
    for (var i = 0; i < Math.min(3, analysis.missingCombinations.length); i++) {
      var combo = analysis.missingCombinations[i];
      var comboStr = [];
      for (var key in combo) {
        if (combo.hasOwnProperty(key)) {
          comboStr.push(key + '=' + combo[key]);
        }
      }
      variantExamples.push(comboStr.join(', '));
    }

    suggestions.push({
      type: "add_variants",
      message: "Consider adding missing variants for completeness",
      variants: variantExamples
    });
  } else if (analysis.missingCombinations.length > 3) {
    suggestions.push({
      type: "architectural_review",
      message: "Too many missing combinations to list",
      recommendation: "Review if all properties are needed or if component should be split."
    });
  }

  // Suggest property consolidation - more strict
  if (propertyCount > 3) {
    suggestions.push({
      type: "consolidate_properties",
      message: "Consider reducing complexity",
      recommendation: propertyCount + " properties create " + analysis.expectedCombinations.length + " possible states. Can any be combined or removed?"
    });
  }

  // Specific suggestions for common patterns
  if (orphanedCount > 0 && analysis.gridCompleteness < 0.6) {
    suggestions.push({
      type: "architectural_fix",
      message: "Classic orthogonality violation detected",
      recommendation: "This appears to be mixing base component logic with conditional features. Split into: 1) Base component, 2) Feature-specific variants."
    });
  }

  return suggestions;
}

function scanCurrentPage() {
  return new Promise(function(resolve) {
    console.log('=== STARTING SCAN OF CURRENT PAGE ===');
    console.log('Page name:', figma.currentPage.name);

    var components = figma.currentPage.findAll(function(node) {
      return node.type === "COMPONENT_SET";
    });

    console.log('Found', components.length, 'component sets on this page');

    // Log each component found with detailed inspection
    for (var i = 0; i < components.length; i++) {
      var comp = components[i];
      console.log('\n--- COMPONENT SET', i + 1, '---');
      console.log('Name:', comp.name);
      console.log('Type:', comp.type);
      console.log('ID:', comp.id);

      // Check what properties exist on the component set
      console.log('Available properties on component set:');
      console.log('  .children:', comp.children ? comp.children.length : 'undefined');
      console.log('  .variants:', comp.variants ? comp.variants.length : 'undefined');
      console.log('  .variantGroupProperties:', comp.variantGroupProperties || 'undefined');

      // According to Figma API docs, COMPONENT_SET has .children array of COMPONENT nodes
      if (comp.children) {
        console.log('  Children details:');
        for (var j = 0; j < comp.children.length; j++) {
          var child = comp.children[j];
          console.log('    Child', j + ':', child.name, 'Type:', child.type);
          if (child.type === 'COMPONENT') {
            console.log('      variantProperties:', child.variantProperties);
          }
        }
      }

      // Check if .variants property exists (might be different in different Figma versions)
      if (comp.variants) {
        console.log('  Direct variants property exists with', comp.variants.length, 'items');
        for (var j = 0; j < comp.variants.length; j++) {
          var variant = comp.variants[j];
          console.log('    Variant', j + ':', variant.name, '| Properties:', variant.variantProperties);
        }
      } else {
        console.log('  No direct .variants property found');
      }
    }

    var results = [];

    for (var i = 0; i < components.length; i++) {
      var component = components[i];
      console.log('\n--- ANALYZING COMPONENT:', component.name, '---');

      var analysis = analyzeComponent(component);

      if (!analysis) {
        console.log('No analysis returned for', component.name, '- skipping');
        continue;
      }

      console.log('Analysis completed for', component.name);
      var issues = categorizeIssues(analysis, component.name);
      console.log('Issues found:', issues.length);

      if (issues.length > 0) {
        console.log('VIOLATION DETECTED:', component.name);
        for (var j = 0; j < issues.length; j++) {
          console.log('  Issue:', issues[j].type, '(' + issues[j].severity + '):', issues[j].message);
        }

        results.push({
          name: component.name,
          id: component.id,
          issues: issues,
          suggestions: generateSuggestions(analysis, component.name),
          analysis: {
            gridCompleteness: analysis.gridCompleteness,
            totalVariants: analysis.actualCombinations.length,
            possibleVariants: analysis.expectedCombinations.length,
            properties: Object.keys(analysis.properties)
          }
        });
      } else {
        console.log('No violations found for', component.name);
      }
    }

    console.log('\n=== SCAN COMPLETE ===');
    console.log('Total components scanned:', components.length);
    console.log('Violations found:', results.length);

    resolve({
      page: figma.currentPage.name,
      componentsScanned: components.length,
      violationsFound: results.length,
      violations: results
    });
  });
}

function scanAllPages() {
  return new Promise(function(resolve) {
    var pages = figma.root.children;
    var allViolations = [];
    var totalComponents = 0;
    var currentPage = figma.currentPage;

    var processPage = function(pageIndex) {
      if (pageIndex >= pages.length) {
        figma.currentPage = currentPage; // Reset to original page
        resolve({
          scope: 'all-pages',
          pagesScanned: pages.length,
          componentsScanned: totalComponents,
          violationsFound: allViolations.length,
          violations: allViolations
        });
        return;
      }

      figma.currentPage = pages[pageIndex];

      scanCurrentPage().then(function(pageResults) {
        allViolations = allViolations.concat(pageResults.violations);
        totalComponents += pageResults.componentsScanned;
        processPage(pageIndex + 1);
      });
    };

    processPage(0);
  });
}