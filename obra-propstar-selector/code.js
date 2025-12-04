// Obra Propstar Select
// Select entire rows or columns in a propstar grid layout based on position

figma.showUI(__html__, { width: 280, height: 180 });

// Tolerance for matching positions (in pixels)
const TOLERANCE = 5;

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'select-row') {
    selectRow();
  } else if (msg.type === 'select-column') {
    selectColumn();
  } else if (msg.type === 'add-next-row') {
    addNextRow();
  } else if (msg.type === 'add-next-column') {
    addNextColumn();
  } else if (msg.type === 'add-prev-row') {
    addPrevRow();
  } else if (msg.type === 'add-prev-column') {
    addPrevColumn();
  }
};

function selectRow() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.notify('Please select an element first');
    return;
  }

  const selected = selection[0];
  const parent = selected.parent;

  if (!parent || !('children' in parent)) {
    figma.notify('Selected element has no siblings');
    return;
  }

  // Get the Y position of the selected element
  const targetY = selected.y;

  // Find all siblings at the same Y position (same row)
  const rowNodes = parent.children.filter(child => {
    if (child.type === 'TEXT') return false;
    return Math.abs(child.y - targetY) <= TOLERANCE;
  });

  figma.currentPage.selection = rowNodes;
  figma.notify(`Selected ${rowNodes.length} items in row`);
}

function selectColumn() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.notify('Please select an element first');
    return;
  }

  const selected = selection[0];
  const parent = selected.parent;

  if (!parent || !('children' in parent)) {
    figma.notify('Selected element has no siblings');
    return;
  }

  // Get the X position of the selected element
  const targetX = selected.x;

  // Find all siblings at the same X position (same column)
  const columnNodes = parent.children.filter(child => {
    if (child.type === 'TEXT') return false;
    return Math.abs(child.x - targetX) <= TOLERANCE;
  });

  figma.currentPage.selection = columnNodes;
  figma.notify(`Selected ${columnNodes.length} items in column`);
}

function addNextRow() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.notify('Please select elements first');
    return;
  }

  // Get all unique Y positions in current selection
  const currentYPositions = [...new Set(selection.map(node => node.y))];
  const maxY = Math.max(...currentYPositions);

  // Find the parent (assume all selected items share a parent)
  const parent = selection[0].parent;

  if (!parent || !('children' in parent)) {
    figma.notify('Cannot find parent container');
    return;
  }

  // Find all unique Y positions in the parent
  const allYPositions = [...new Set(
    parent.children
      .filter(child => child.type !== 'TEXT')
      .map(child => child.y)
  )].sort((a, b) => a - b);

  // Find the next Y position after the current max
  const nextY = allYPositions.find(y => y > maxY + TOLERANCE);

  if (nextY === undefined) {
    figma.notify('No more rows below');
    return;
  }

  // Get all nodes at the next Y position
  const nextRowNodes = parent.children.filter(child => {
    if (child.type === 'TEXT') return false;
    return Math.abs(child.y - nextY) <= TOLERANCE;
  });

  // Combine current selection with next row
  const newSelection = [...selection, ...nextRowNodes];
  figma.currentPage.selection = newSelection;
  figma.notify(`Added ${nextRowNodes.length} items from next row`);
}

function addNextColumn() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.notify('Please select elements first');
    return;
  }

  // Get all unique X positions in current selection
  const currentXPositions = [...new Set(selection.map(node => node.x))];
  const maxX = Math.max(...currentXPositions);

  // Find the parent (assume all selected items share a parent)
  const parent = selection[0].parent;

  if (!parent || !('children' in parent)) {
    figma.notify('Cannot find parent container');
    return;
  }

  // Find all unique X positions in the parent
  const allXPositions = [...new Set(
    parent.children
      .filter(child => child.type !== 'TEXT')
      .map(child => child.x)
  )].sort((a, b) => a - b);

  // Find the next X position after the current max
  const nextX = allXPositions.find(x => x > maxX + TOLERANCE);

  if (nextX === undefined) {
    figma.notify('No more columns to the right');
    return;
  }

  // Get all nodes at the next X position
  const nextColumnNodes = parent.children.filter(child => {
    if (child.type === 'TEXT') return false;
    return Math.abs(child.x - nextX) <= TOLERANCE;
  });

  // Combine current selection with next column
  const newSelection = [...selection, ...nextColumnNodes];
  figma.currentPage.selection = newSelection;
  figma.notify(`Added ${nextColumnNodes.length} items from next column`);
}

function addPrevRow() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.notify('Please select elements first');
    return;
  }

  // Get all unique Y positions in current selection
  const currentYPositions = [...new Set(selection.map(node => node.y))];
  const minY = Math.min(...currentYPositions);

  // Find the parent (assume all selected items share a parent)
  const parent = selection[0].parent;

  if (!parent || !('children' in parent)) {
    figma.notify('Cannot find parent container');
    return;
  }

  // Find all unique Y positions in the parent
  const allYPositions = [...new Set(
    parent.children
      .filter(child => child.type !== 'TEXT')
      .map(child => child.y)
  )].sort((a, b) => b - a); // Sort descending to find previous

  // Find the previous Y position before the current min
  const prevY = allYPositions.find(y => y < minY - TOLERANCE);

  if (prevY === undefined) {
    figma.notify('No more rows above');
    return;
  }

  // Get all nodes at the previous Y position
  const prevRowNodes = parent.children.filter(child => {
    if (child.type === 'TEXT') return false;
    return Math.abs(child.y - prevY) <= TOLERANCE;
  });

  // Combine current selection with previous row
  const newSelection = [...selection, ...prevRowNodes];
  figma.currentPage.selection = newSelection;
  figma.notify(`Added ${prevRowNodes.length} items from previous row`);
}

function addPrevColumn() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.notify('Please select elements first');
    return;
  }

  // Get all unique X positions in current selection
  const currentXPositions = [...new Set(selection.map(node => node.x))];
  const minX = Math.min(...currentXPositions);

  // Find the parent (assume all selected items share a parent)
  const parent = selection[0].parent;

  if (!parent || !('children' in parent)) {
    figma.notify('Cannot find parent container');
    return;
  }

  // Find all unique X positions in the parent
  const allXPositions = [...new Set(
    parent.children
      .filter(child => child.type !== 'TEXT')
      .map(child => child.x)
  )].sort((a, b) => b - a); // Sort descending to find previous

  // Find the previous X position before the current min
  const prevX = allXPositions.find(x => x < minX - TOLERANCE);

  if (prevX === undefined) {
    figma.notify('No more columns to the left');
    return;
  }

  // Get all nodes at the previous X position
  const prevColumnNodes = parent.children.filter(child => {
    if (child.type === 'TEXT') return false;
    return Math.abs(child.x - prevX) <= TOLERANCE;
  });

  // Combine current selection with previous column
  const newSelection = [...selection, ...prevColumnNodes];
  figma.currentPage.selection = newSelection;
  figma.notify(`Added ${prevColumnNodes.length} items from previous column`);
}
