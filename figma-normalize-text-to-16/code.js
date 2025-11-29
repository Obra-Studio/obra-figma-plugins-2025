
// This function iterates over the selected nodes and updates the font size
function normalizeTextTo16() {
  const nodes = figma.currentPage.selection;

  for (const node of nodes) {
    if (node.type === "TEXT") {
      node.fontSize = 16
    }
  }

}

// Run the function
figma.loadFontAsync({ family: "Inter", style: "Regular" }).then(() => {
    normalizeTextTo16();
    figma.closePlugin();
})

