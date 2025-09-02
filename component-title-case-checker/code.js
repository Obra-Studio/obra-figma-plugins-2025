
figma.showUI(__html__, { width: 400, height: 600 });

function toTitleCase(str) {
  return str.replace(/\w\S*/g, function(txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

function isTitleCase(str) {
  // Remove special characters and numbers for checking
  var cleanStr = str.replace(/[^a-zA-Z\s]/g, ' ').trim();
  if (!cleanStr) return true; // If no letters, consider valid
  
  var titleCased = toTitleCase(cleanStr);
  var originalCleaned = cleanStr.replace(/\s+/g, ' ');
  
  return titleCased === originalCleaned;
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

function checkComponentsOnCurrentPage() {
  var currentPage = figma.currentPage;
  var results = [];
  
  // Find all component instances and component sets on the current page
  function findComponents(node) {
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || node.type === 'INSTANCE') {
      var isValid = isTitleCase(node.name);
      var result = createComponentCheckResult(
        node.id,
        node.name,
        node.type,
        isValid,
        isValid ? undefined : toTitleCase(node.name)
      );
      results.push(result);
    }
    
    if (node.children && node.children.length > 0) {
      for (var i = 0; i < node.children.length; i++) {
        findComponents(node.children[i]);
      }
    }
  }
  
  for (var i = 0; i < currentPage.children.length; i++) {
    findComponents(currentPage.children[i]);
  }
  
  return results;
}

function selectNodes(nodeIds) {
  var nodes = [];
  
  for (var i = 0; i < nodeIds.length; i++) {
    var node = figma.getNodeById(nodeIds[i]);
    if (node !== null) {
      nodes.push(node);
    }
  }
  
  figma.currentPage.selection = nodes;
  
  if (nodes.length > 0) {
    figma.viewport.scrollAndZoomIntoView(nodes);
  }
}

function renameNode(nodeId, newName) {
  var node = figma.getNodeById(nodeId);
  if (node && node.name !== undefined) {
    node.name = newName;
    return true;
  }
  return false;
}

// Handle messages from UI
figma.ui.onmessage = function(msg) {
  var results;
  var success;
  
  switch (msg.type) {
    case 'check-components':
      results = checkComponentsOnCurrentPage();
      figma.ui.postMessage({
        type: 'check-results',
        results: results
      });
      break;
      
    case 'select-nodes':
      selectNodes(msg.nodeIds);
      break;
      
    case 'rename-node':
      success = renameNode(msg.nodeId, msg.newName);
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

// Initial check when plugin loads
var initialResults = checkComponentsOnCurrentPage();
figma.ui.postMessage({
  type: 'check-results',
  results: initialResults
});