
figma.showUI(__html__, { width: 400, height: 600 });

function toTitleCase(str) {
  return str.replace(/\w\S*/g, function(txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

function fixVariantName(str) {
  // For variant names like "Type=text value", fix only the invalid parts
  if (str.includes('=') && str.includes(',')) {
    var parts = str.split(',');
    var fixedParts = [];

    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var keyValue = part.split('=');

      if (keyValue.length === 2) {
        var key = keyValue[0].trim();
        var value = keyValue[1].trim();

        // Fix key if needed (property name)
        var fixedKey = isValidVariantProperty(key) ? key : fixVariantProperty(key);

        // Fix value if needed
        var fixedValue = isValidVariantValue(value) ? value : fixVariantValue(value);

        fixedParts.push(fixedKey + '=' + fixedValue);
      } else {
        // Malformed part, just title case it
        fixedParts.push(toTitleCase(part));
      }
    }

    return fixedParts.join(', ');
  }

  // Not a variant name, use regular title case
  return toTitleCase(str);
}

function fixVariantProperty(property) {
  // Fix property name by title-casing each word
  var words = property.trim().split(/\s+/);
  var fixedWords = [];

  for (var i = 0; i < words.length; i++) {
    var word = words[i];
    if (word.length > 0) {
      fixedWords.push(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    }
  }

  return fixedWords.join(' ');
}

function fixVariantValue(value) {
  // For variant values, if it's a word, make it title case
  // Numbers, number+string, abbreviations, and boolean-likes stay as-is or get minimal fixes
  if (/^\d+$/.test(value)) return value; // Numbers stay as-is (24)
  if (/^\d+[a-zA-Z]+$/.test(value)) return value; // Number+string combos stay as-is (24px, 2REM, 100VH)
  if (/^(yes|no|true|false)$/i.test(value)) {
    // Capitalize boolean-like values
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
  if (/^[A-Z]{2,}$/.test(value)) return value; // Abbreviations stay as-is (OTP, API, URL)

  // Otherwise apply title case to each word
  return fixVariantProperty(value);
}

function isTitleCase(str) {
  // Check if this is a component variant name (contains = and ,)
  if (str.includes('=') && str.includes(',')) {
    // This is a variant naming pattern, validate each part separately
    var parts = str.split(',');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var keyValue = part.split('=');
      if (keyValue.length === 2) {
        var key = keyValue[0].trim();
        var value = keyValue[1].trim();

        // Validate key and value are title case (allow spaces in property names)
        if (!isValidVariantProperty(key) || !isValidVariantValue(value)) {
          return false;
        }
      }
    }
    return true;
  }

  // Regular title case validation for non-variant names
  return isSimpleTitleCase(str);
}

function isSimpleTitleCase(str) {
  // Remove special characters and numbers for checking, but preserve spaces
  var cleanStr = str.replace(/[^a-zA-Z\s]/g, ' ').trim();
  if (!cleanStr) return true; // If no letters, consider valid

  // Normalize spaces and check if it matches title case
  var normalizedStr = cleanStr.replace(/\s+/g, ' ');
  var titleCased = toTitleCase(normalizedStr);

  return titleCased === normalizedStr;
}

function isValidVariantProperty(property) {
  // Property names can have spaces (e.g., "Flip icon", "Show label")
  // Each word should be title case
  var words = property.trim().split(/\s+/);
  for (var i = 0; i < words.length; i++) {
    var word = words[i];
    if (word.length > 0) {
      // Check if word starts with uppercase and rest is lowercase
      var expectedWord = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      if (word !== expectedWord) {
        return false;
      }
    }
  }
  return true;
}

function isValidVariantValue(value) {
  // Variant values can be various formats: Default, No, Yes, 24, 24px, OTP, etc.
  // Accept title case, all caps, numbers, number+string, abbreviations, or boolean-like values
  if (/^\d+$/.test(value)) return true; // Numbers are valid (24)
  if (/^\d+[a-zA-Z]+$/.test(value)) return true; // Numbers with any letters (24px, 2REM, 100VH, etc.)
  if (/^(Yes|No|True|False)$/i.test(value)) return true; // Boolean-like values
  if (/^[A-Z]{2,}$/.test(value)) return true; // Common abbreviations (OTP, API, URL, etc.)
  return isSimpleTitleCase(value); // Otherwise check title case
}

function createComponentCheckResult(id, name, type, isValid, suggestedName) {
  return {
    id: id,
    name: name,
    type: type,
    isValid: isValid,
    suggestedName: suggestedName
  };
}

function checkComponentsOnCurrentPage(whitelist) {
  var currentPage = figma.currentPage;
  var results = [];
  var totalComponents = 0;
  var scannedComponents = 0;
  var lastProgressUpdate = 0;

  whitelist = whitelist || [];

  // Pre-compile whitelist for faster matching
  var whitelistMap = {};
  var whitelistPrefixes = [];
  for (var i = 0; i < whitelist.length; i++) {
    var entry = whitelist[i];
    whitelistMap[entry] = true;
    whitelistPrefixes.push(entry);
  }

  function isInWhitelist(name) {
    // Fast exact match first
    if (whitelistMap[name]) {
      return true;
    }

    // Prefix matching only if needed
    for (var i = 0; i < whitelistPrefixes.length; i++) {
      var prefix = whitelistPrefixes[i];
      if (prefix.length < name.length && name.indexOf(prefix) === 0) {
        return true;
      }
    }
    return false;
  }

  function sendProgressUpdate(force) {
    // Batch progress updates - only send every 10 components or when forced
    if (force || scannedComponents - lastProgressUpdate >= 10) {
      figma.ui.postMessage({
        type: 'scan-progress',
        scanned: scannedComponents,
        total: totalComponents
      });
      lastProgressUpdate = scannedComponents;
    }
  }

  // Single pass: count and process components simultaneously
  function processComponents(node) {
    // Skip instances entirely - don't process them or their children
    if (node.type === 'INSTANCE') {
      return;
    }

    // Early termination: if node has no children, skip deeper traversal
    var hasChildren = node.children && node.children.length > 0;

    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      totalComponents++;
      scannedComponents++;

      sendProgressUpdate(false);

      var isWhitelisted = isInWhitelist(node.name);
      var isValid = isWhitelisted || isTitleCase(node.name);

      // Only show invalid components that need fixing (skip valid and whitelisted)
      if (!isWhitelisted && !isValid) {
        var result = createComponentCheckResult(
          node.id,
          node.name,
          node.type,
          isValid,
          fixVariantName(node.name)
        );
        results.push(result);
      }
    }

    // Only traverse children if they exist (but skip instance children)
    if (hasChildren) {
      for (var i = 0; i < node.children.length; i++) {
        processComponents(node.children[i]);
      }
    }
  }

  // Send initial state
  figma.ui.postMessage({
    type: 'scan-progress',
    scanned: 0,
    total: 0
  });

  // Single-pass processing
  for (var i = 0; i < currentPage.children.length; i++) {
    processComponents(currentPage.children[i]);
  }

  // Send final progress update
  sendProgressUpdate(true);

  return {
    results: results,
    totalScanned: totalComponents
  };
}

async function selectNodes(nodeIds) {
  var nodes = [];

  for (var i = 0; i < nodeIds.length; i++) {
    var node = await figma.getNodeByIdAsync(nodeIds[i]);
    if (node !== null) {
      nodes.push(node);
    }
  }

  figma.currentPage.selection = nodes;

  if (nodes.length > 0) {
    figma.viewport.scrollAndZoomIntoView(nodes);
  }
}

async function renameNode(nodeId, newName) {
  var node = await figma.getNodeByIdAsync(nodeId);
  if (node && node.name !== undefined) {
    node.name = newName;
    return true;
  }
  return false;
}

// Handle messages from UI
figma.ui.onmessage = async function(msg) {
  var results;
  var success;

  switch (msg.type) {
    case 'load-whitelist':
      figma.clientStorage.getAsync('whitelist').then(function(whitelist) {
        figma.ui.postMessage({
          type: 'whitelist-loaded',
          whitelist: whitelist || []
        });
      });
      break;

    case 'save-whitelist':
      figma.clientStorage.setAsync('whitelist', msg.whitelist);
      break;

    case 'check-components':
      var scanResult = checkComponentsOnCurrentPage(msg.whitelist);
      figma.ui.postMessage({
        type: 'check-results',
        results: scanResult.results,
        totalScanned: scanResult.totalScanned
      });
      break;

    case 'select-nodes':
      await selectNodes(msg.nodeIds);
      break;

    case 'rename-node':
      success = await renameNode(msg.nodeId, msg.newName);
      figma.ui.postMessage({
        type: 'rename-result',
        success: success,
        nodeId: msg.nodeId
      });
      break;

    case 'close':
      figma.closePlugin();
      break;
  }
};

// No initial scan - wait for user to trigger manually