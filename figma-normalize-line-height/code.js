
// This function iterates over the selected nodes and updates the lline height
function setLineHeightAuto() {
  const nodes = figma.currentPage.selection;

  for (const node of nodes) {
    if (node.type === "TEXT") {
      node.lineHeight = { unit: 'AUTO' };
    }
  }

}

// Run the function
figma.loadFontAsync({ family: "Inter", style: "Regular" }).then(() => {
    setLineHeightAuto();
    figma.closePlugin();
})

