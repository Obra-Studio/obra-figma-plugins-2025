figma.showUI(__html__, { width: 300, height: 200 });

figma.ui.onmessage = async function(msg) {
  if (msg.type === 'replace-variables') {
    var oldPrefix = msg.oldPrefix;
    var newPrefix = msg.newPrefix;
    
    if (!oldPrefix || !newPrefix) {
      figma.ui.postMessage({ type: 'error', message: 'Please enter both old and new prefixes' });
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

    for (var i = 0; i < selection.length; i++) {
      var node = selection[i];
      
      // Handle fills
      if ('fills' in node && node.fills && Array.isArray(node.fills)) {
        var newFills = [];
        var hasChanges = false;

        for (var j = 0; j < node.fills.length; j++) {
          var fill = node.fills[j];
          
          if (fill.type === 'SOLID' && fill.boundVariables && fill.boundVariables.color) {
            var currentVariable = figma.variables.getVariableById(fill.boundVariables.color.id);
            
            if (currentVariable && currentVariable.name.startsWith(oldPrefix)) {
              // Extract the suffix (e.g., "50", "100", "150")
              var suffix = currentVariable.name.substring(oldPrefix.length);
              var newVariableName = newPrefix + suffix;
              
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
                console.warn('Variable "' + newVariableName + '" not found');
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

      // Handle strokes as well
      if ('strokes' in node && node.strokes && Array.isArray(node.strokes)) {
        var newStrokes = [];
        var hasChanges = false;

        for (var k = 0; k < node.strokes.length; k++) {
          var stroke = node.strokes[k];
          
          if (stroke.type === 'SOLID' && stroke.boundVariables && stroke.boundVariables.color) {
            var currentVariable = figma.variables.getVariableById(stroke.boundVariables.color.id);
            
            if (currentVariable && currentVariable.name.startsWith(oldPrefix)) {
              var suffix = currentVariable.name.substring(oldPrefix.length);
              var newVariableName = newPrefix + suffix;
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
                console.warn('Variable "' + newVariableName + '" not found');
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
    }

    if (replacedCount > 0) {
      figma.ui.postMessage({ 
        type: 'success', 
        message: 'Successfully replaced ' + replacedCount + ' variable(s)'
      });
    } else {
      figma.ui.postMessage({ 
        type: 'warning', 
        message: 'No variables were replaced. Make sure selected layers have variables with the specified prefix.' 
      });
    }
  }

  if (msg.type === 'close') {
    figma.closePlugin();
  }
};