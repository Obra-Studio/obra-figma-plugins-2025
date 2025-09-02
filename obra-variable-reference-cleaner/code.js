
figma.showUI(__html__, { width: 400, height: 500 });

// Helper function to get all bound variables for a node
function getBoundVariables(node) {
  var boundVariables = [];
  
  // Check different properties that can have variables bound
  var properties = ['fills', 'strokes', 'effects', 'strokeWeight', 'cornerRadius', 'width', 'height', 'x', 'y', 'rotation', 'opacity'];
  
  for (var i = 0; i < properties.length; i++) {
    var prop = properties[i];
    try {
      var boundVariable = figma.variables.getBoundVariables(node, prop);
      if (boundVariable && Object.keys(boundVariable).length > 0) {
        boundVariables.push({
          property: prop,
          bindings: boundVariable
        });
      }
    } catch (e) {
      // Property might not support variables, continue
    }
  }
  
  return boundVariables;
}

// Helper function to check if a variable has external references
function hasExternalReference(variable) {
  if (!variable || !variable.valuesByMode) {
    return false;
  }
  
  // Check each mode's value
  var modes = Object.keys(variable.valuesByMode);
  for (var i = 0; i < modes.length; i++) {
    var mode = modes[i];
    var value = variable.valuesByMode[mode];
    
    // Check if the value is a variable alias (external reference)
    if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
      return true;
    }
  }
  
  return false;
}

// Helper function to get the primitive variable (follows the chain to the end)
function getPrimitiveVariable(variable) {
  if (!variable || !variable.valuesByMode) {
    return null;
  }
  
  var current = variable;
  var visited = new Set();
  
  // Follow the chain of variable references
  while (current && hasExternalReference(current)) {
    // Prevent infinite loops
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);
    
    // Get the first mode's value (assuming all modes point to the same reference)
    var modes = Object.keys(current.valuesByMode);
    if (modes.length === 0) break;
    
    var value = current.valuesByMode[modes[0]];
    if (value && value.type === 'VARIABLE_ALIAS' && value.id) {
      try {
        current = figma.variables.getVariableById(value.id);
      } catch (e) {
        break;
      }
    } else {
      break;
    }
  }
  
  return current;
}

// Helper function to process a single node
function processNode(node, results) {
  var boundVariables = getBoundVariables(node);
  
  if (boundVariables.length === 0) {
    return;
  }
  
  var hasChanges = false;
  var nodeResult = {
    node: node,
    changes: []
  };
  
  for (var i = 0; i < boundVariables.length; i++) {
    var boundVar = boundVariables[i];
    var property = boundVar.property;
    var bindings = boundVar.bindings;
    
    // Process each binding for this property
    var bindingKeys = Object.keys(bindings);
    for (var j = 0; j < bindingKeys.length; j++) {
      var bindingKey = bindingKeys[j];
      var binding = bindings[bindingKey];
      
      if (binding && binding.id) {
        try {
          var variable = figma.variables.getVariableById(binding.id);
          
          if (hasExternalReference(variable)) {
            var primitiveVar = getPrimitiveVariable(variable);
            
            if (primitiveVar && primitiveVar.id !== variable.id) {
              // Create new binding to primitive variable
              var newBinding = {
                id: primitiveVar.id
              };
              
              // Apply the new binding
              var newBindings = {};
              newBindings[bindingKey] = newBinding;
              figma.variables.setBoundVariables(node, property, newBindings);
              
              nodeResult.changes.push({
                property: property + '.' + bindingKey,
                from: variable.name,
                to: primitiveVar.name
              });
              
              hasChanges = true;
            }
          }
        } catch (e) {
          console.error('Error processing variable:', e);
        }
      }
    }
  }
  
  if (hasChanges) {
    results.push(nodeResult);
  }
}

// Helper function to traverse all nodes in the document
function traverseNodes(node, results) {
  processNode(node, results);
  
  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      traverseNodes(node.children[i], results);
    }
  }
}

// Main function to process all nodes
function processAllNodes() {
  var results = [];
  var pages = figma.root.children;
  
  figma.ui.postMessage({
    type: 'progress',
    message: 'Scanning for variable references...'
  });
  
  for (var i = 0; i < pages.length; i++) {
    traverseNodes(pages[i], results);
  }
  
  figma.ui.postMessage({
    type: 'complete',
    results: results.map(function(result) {
      return {
        nodeName: result.node.name,
        nodeType: result.node.type,
        changes: result.changes
      };
    })
  });
}

// Handle messages from UI
figma.ui.onmessage = function(msg) {
  if (msg.type === 'process') {
    processAllNodes();
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};