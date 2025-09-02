<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 16px;
      font-size: 12px;
      background: #f8f8f8;
    }
    
    .header {
      margin-bottom: 16px;
    }
    
    .header h2 {
      margin: 0 0 8px 0;
      color: #333;
      font-size: 14px;
      font-weight: 600;
    }
    
    .stats {
      background: white;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 16px;
      border: 1px solid #e0e0e0;
    }
    
    .stats-grid {
      display: table;
      width: 100%;
      table-layout: fixed;
    }
    
    .stat-item {
      display: table-cell;
      text-align: center;
      width: 50%;
    }
    
    .stat-number {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    
    .stat-number.valid {
      color: #00b894;
    }
    
    .stat-number.invalid {
      color: #e17055;
    }
    
    .stat-label {
      color: #666;
      font-size: 11px;
    }
    
    .controls {
      margin-bottom: 16px;
    }
    
    .controls button {
      margin-right: 8px;
    }
    
    button {
      background: #18a0fb;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
    }
    
    button:hover {
      background: #1592e6;
    }
    
    button.secondary {
      background: #f0f0f0;
      color: #333;
    }
    
    button.secondary:hover {
      background: #e0e0e0;
    }
    
    .results {
      max-height: 400px;
      overflow-y: auto;
    }
    
    .result-item {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 8px;
    }
    
    .result-item.valid {
      border-left: 3px solid #00b894;
    }
    
    .result-item.invalid {
      border-left: 3px solid #e17055;
    }
    
    .result-header {
      margin-bottom: 8px;
    }
    
    .component-name {
      font-weight: 500;
      font-size: 13px;
      display: inline-block;
      width: 60%;
      vertical-align: middle;
    }
    
    .component-type {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      color: #666;
      display: inline-block;
      margin-left: 8px;
      vertical-align: middle;
    }
    
    .status {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: 500;
      display: inline-block;
      margin-left: 8px;
      vertical-align: middle;
    }
    
    .status.valid {
      background: #00b894;
      color: white;
    }
    
    .status.invalid {
      background: #e17055;
      color: white;
    }
    
    .suggestion {
      margin-top: 8px;
      padding: 8px;
      background: #fff3cd;
      border-radius: 4px;
      font-size: 11px;
    }
    
    .suggestion-text {
      margin-bottom: 6px;
      color: #856404;
    }
    
    .suggested-name {
      font-weight: 500;
      color: #333;
    }
    
    .action-buttons {
      margin-top: 8px;
    }
    
    .action-buttons button {
      padding: 4px 8px;
      font-size: 10px;
      margin-right: 6px;
    }
    
    .empty-state {
      text-align: center;
      color: #666;
      padding: 32px 16px;
    }
    
    .loading {
      text-align: center;
      padding: 32px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>Component Title Case Checker</h2>
    <p>Checks if component names follow Title Case naming convention</p>
  </div>
  
  <div class="stats" id="stats" style="display: none;">
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-number valid" id="validCount">0</div>
        <div class="stat-label">Valid Names</div>
      </div>
      <div class="stat-item">
        <div class="stat-number invalid" id="invalidCount">0</div>
        <div class="stat-label">Need Fixing</div>
      </div>
    </div>
  </div>
  
  <div class="controls">
    <button onclick="checkComponents()">Refresh Check</button>
    <button class="secondary" onclick="selectInvalid()">Select Invalid</button>
  </div>
  
  <div id="loading" class="loading">
    Checking components...
  </div>
  
  <div id="results" class="results" style="display: none;"></div>

  <script>
    var currentResults = [];
    
    function checkComponents() {
      document.getElementById('loading').style.display = 'block';
      document.getElementById('results').style.display = 'none';
      document.getElementById('stats').style.display = 'none';
      
      parent.postMessage({
        pluginMessage: { type: 'check-components' }
      }, '*');
    }
    
    function selectInvalid() {
      var invalidNodes = [];
      
      for (var i = 0; i < currentResults.length; i++) {
        if (!currentResults[i].isValid) {
          invalidNodes.push(currentResults[i].id);
        }
      }
      
      if (invalidNodes.length > 0) {
        parent.postMessage({
          pluginMessage: { 
            type: 'select-nodes',
            nodeIds: invalidNodes
          }
        }, '*');
      }
    }
    
    function selectNode(nodeId) {
      parent.postMessage({
        pluginMessage: { 
          type: 'select-nodes',
          nodeIds: [nodeId]
        }
      }, '*');
    }
    
    function renameNode(nodeId, newName) {
      parent.postMessage({
        pluginMessage: { 
          type: 'rename-node',
          nodeId: nodeId,
          newName: newName
        }
      }, '*');
    }
    
    function filterResults(results, isValid) {
      var filtered = [];
      for (var i = 0; i < results.length; i++) {
        if (results[i].isValid === isValid) {
          filtered.push(results[i]);
        }
      }
      return filtered;
    }
    
    function displayResults(results) {
      currentResults = results;
      
      document.getElementById('loading').style.display = 'none';
      document.getElementById('results').style.display = 'block';
      document.getElementById('stats').style.display = 'block';
      
      // Update stats
      var validResults = filterResults(results, true);
      var invalidResults = filterResults(results, false);
      var validCount = validResults.length;
      var invalidCount = invalidResults.length;
      
      document.getElementById('validCount').textContent = validCount;
      document.getElementById('invalidCount').textContent = invalidCount;
      
      // Display results
      var resultsContainer = document.getElementById('results');
      
      if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="empty-state">No components found on this page</div>';
        return;
      }
      
      var html = '';
      for (var i = 0; i < results.length; i++) {
        var result = results[i];
        var validClass = result.isValid ? 'valid' : 'invalid';
        var statusText = result.isValid ? 'VALID' : 'INVALID';
        var statusClass = result.isValid ? 'valid' : 'invalid';
        
        html += '<div class="result-item ' + validClass + '">';
        html += '<div class="result-header">';
        html += '<div class="component-name">' + result.name + '</div>';
        html += '<div class="component-type">' + result.type + '</div>';
        html += '<div class="status ' + statusClass + '">' + statusText + '</div>';
        html += '</div>';
        
        if (!result.isValid) {
          html += '<div class="suggestion">';
          html += '<div class="suggestion-text">Suggested name:</div>';
          html += '<div class="suggested-name">' + result.suggestedName + '</div>';
          html += '<div class="action-buttons">';
          html += '<button onclick="renameNode(\'' + result.id + '\', \'' + result.suggestedName + '\')">Apply Fix</button>';
          html += '<button class="secondary" onclick="selectNode(\'' + result.id + '\')">Select</button>';
          html += '</div>';
          html += '</div>';
        }
        
        html += '</div>';
      }
      
      resultsContainer.innerHTML = html;
    }
    
    // Listen for messages from plugin
    window.onmessage = function(event) {
      var message = event.data.pluginMessage;
      var type = message.type;
      
      if (type === 'check-results') {
        displayResults(message.results);
      } else if (type === 'rename-result') {
        if (message.success) {
          // Refresh the results after successful rename
          checkComponents();
        }
      }
    };
  </script>
</body>
</html>