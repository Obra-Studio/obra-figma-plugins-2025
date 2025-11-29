// I did not like the other plugins that converted to sentence case so I wrote my own.

// Function to convert text to sentence case
function toSentenceCase(text) {
  // Check if the text is all uppercase
  if (text === text.toUpperCase()) {
    // Convert to sentence case
    const lowerCaseText = text.toLowerCase();
    return lowerCaseText.charAt(0).toUpperCase() + lowerCaseText.slice(1);
  }
  return text;
}

// This function iterates over the selected nodes and updates the text
function convertSelectedTextToSentenceCase() {
  const nodes = figma.currentPage.selection;

  for (const node of nodes) {
    if (node.type === "TEXT") {
      console.log(node.characters)
      const sentenceCaseText = toSentenceCase(node.characters);
      console.log(sentenceCaseText)
      node.characters = sentenceCaseText;
    }
  }

}

// Run the function
//
// async function loadSpecificFont(node) {
//   // Detecting the font from the first character, loading it, and applying it to the whole node. This way we can drop styling without loading all used fonts
//   var nodeFirstFont = node.getRangeFontName(0,1)
//   await figma.loadFontAsync(nodeFirstFont as FontName)
//
//   // If there was style on the first character we applying it to whole text, if not, changing the font of whole text to one from the first character.
//   if (nodeFirstStyle){
//     node.textStyleId = nodeFirstStyle
//   }
//   else{
//     node.fontName = nodeFirstFont;
//   }
// }

async function loadGeneralFonts() {
  await Promise.all([
    figma.loadFontAsync({
      family: "Inter",
      style: "Regular"
    }),
    figma.loadFontAsync({
      family: "Inter",
      style: "Bold"
    }),
    figma.loadFontAsync({
      family: "Inter",
      style: "Medium"
    })
  ])
}


async function initialize() {
  await loadGeneralFonts();
  //loadSpecificFont(node)
  convertSelectedTextToSentenceCase();
  figma.closePlugin();
}

initialize();