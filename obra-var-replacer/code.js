figma.showUI(__html__, { width: 320, height: 350 });

figma.ui.onmessage = async function(msg) {
  if (msg.type === 'replace-variables') {
    var oldPrefix = msg.oldPrefix;
    var newPrefix = msg.newPrefix;
    
    if (!oldPrefix || !newPrefix) {
      figma.ui.postMessage({ type: 'error', message: 'Please enter both text to replace and replacement text' });
      return;
    }

    var selection = figma.currentPage.selection;
    
    if (selection.length === 0) {
      figma.ui.postMessage({ type: 'error', message: 'Please select at least one layer' });
      return;
    }

    var replacedCount = 0;
    var allVariables = await figma.variables.getLocalVariablesAsync();
    
    // Create a map of variable names to variable objects for quick lookup
    var variableMap = new Map();
    allVariables.forEach(function(variable) {
      variableMap.set(variable.name, variable);
    });

    
    // Helper function to process a node and replace its variables
    async function processNodeVariables(node) {
      // Handle fills
      if ('fills' in node && node.fills && Array.isArray(node.fills)) {
        var newFills = [];
        var hasChanges = false;

        for (var j = 0; j < node.fills.length; j++) {
          var fill = node.fills[j];
          
          if (fill.type === 'SOLID' && fill.boundVariables && fill.boundVariables.color) {
            var currentVariable = await figma.variables.getVariableByIdAsync(fill.boundVariables.color.id);
            
            if (currentVariable) {
              if (currentVariable.name.includes(oldPrefix)) {
                // Replace ALL occurrences of the old text with the new one
                var newVariableName = currentVariable.name.split(oldPrefix).join(newPrefix);
                
                // Find the new variable
                var newVariable = variableMap.get(newVariableName);
                
                if (newVariable) {
                  var newFill = Object.assign({}, fill, {
                    boundVariables: Object.assign({}, fill.boundVariables, {
                      color: { type: 'VARIABLE_ALIAS', id: newVariable.id }
                    })
                  });
                  newFills.push(newFill);
                  hasChanges = true;
                  replacedCount++;
                } else {
                  // Variable not found, keep original
                  newFills.push(fill);
                }
              } else {
                newFills.push(fill);
              }
            } else {
              newFills.push(fill);
            }
          } else {
            newFills.push(fill);
          }
        }

        if (hasChanges) {
          node.fills = newFills;
        }
      }

      // Handle strokes
      if ('strokes' in node && node.strokes && Array.isArray(node.strokes)) {
        var newStrokes = [];
        var hasChanges = false;

        for (var k = 0; k < node.strokes.length; k++) {
          var stroke = node.strokes[k];
          
          if (stroke.type === 'SOLID' && stroke.boundVariables && stroke.boundVariables.color) {
            var currentVariable = await figma.variables.getVariableByIdAsync(stroke.boundVariables.color.id);
            
            if (currentVariable) {
              if (currentVariable.name.includes(oldPrefix)) {
                // Replace ALL occurrences of the old text with the new one
                var newVariableName = currentVariable.name.split(oldPrefix).join(newPrefix);
                
                var newVariable = variableMap.get(newVariableName);
                
                if (newVariable) {
                  var newStroke = Object.assign({}, stroke, {
                    boundVariables: Object.assign({}, stroke.boundVariables, {
                      color: { type: 'VARIABLE_ALIAS', id: newVariable.id }
                    })
                  });
                  newStrokes.push(newStroke);
                  hasChanges = true;
                  replacedCount++;
                } else {
                  newStrokes.push(stroke);
                }
              } else {
                newStrokes.push(stroke);
              }
            } else {
              newStrokes.push(stroke);
            }
          } else {
            newStrokes.push(stroke);
          }
        }

        if (hasChanges) {
          node.strokes = newStrokes;
        }
      }
      
      // Recursively process children
      if ('children' in node && node.children) {
        for (var i = 0; i < node.children.length; i++) {
          await processNodeVariables(node.children[i]);
        }
      }
    }
    
    // Process selected nodes for variable replacement
    for (var i = 0; i < selection.length; i++) {
      await processNodeVariables(selection[i]);
    }

    if (replacedCount > 0) {
      figma.ui.postMessage({ 
        type: 'success', 
        message: 'Successfully replaced ' + replacedCount + ' variable(s)'
      });
    } else {
      figma.ui.postMessage({ 
        type: 'warning', 
        message: 'No variables were replaced. Make sure selected layers have variables containing the specified text.' 
      });
    }
  }

  if (msg.type === 'close') {
    figma.closePlugin();
  }
};