# Component Variant Validator - Figma Plugin

A Figma plugin that detects "illegal" component variants that violate orthogonal design principles. Helps maintain clean, scalable design systems by identifying components with variant combinations that can't be expressed as clean grids.

## What it detects

### Illegal Patterns
- **Sparse Grids**: Components where <80% of possible variant combinations exist
- **Orphaned Properties**: Variant properties that only work with specific other values
- **Excessive Complexity**: Components with too many conflicting property combinations

### Examples of Problems
- Button component where "icon" variant only works with "primary" color
- Card component where "compact spacing" only applies to horizontal orientation
- Input field where validation states conflict with certain sizes

## Setup Instructions

### 1. Create Plugin Files
Create a new folder for your plugin with these files:

```
my-variant-validator/
├── manifest.json
├── code.js
├── ui.html
└── README.md
```

### 2. File Contents
Copy the provided code into each respective file:
- `manifest.json` - Plugin configuration
- `code.js` - Main plugin logic
- `ui.html` - User interface
- `README.md` - This documentation

### 3. Install in Figma

#### Option A: Development Mode
1. Open Figma Desktop App
2. Go to Plugins → Development → Import plugin from manifest
3. Select your `manifest.json` file
4. Plugin appears in Plugins → Development → Component Variant Validator

#### Option B: Local Development
1. In Figma Desktop: Plugins → Development → New Plugin
2. Choose "Empty" template
3. Replace generated files with the provided code
4. Save and run

### 4. Usage
1. Open any Figma file with component sets
2. Run the plugin from Plugins menu
3. Click "Scan Current Page" or "Scan All Pages"
4. Click on violations to navigate to problematic components

## Configuration

Edit `CONFIG` object in `code.js` to customize:

```javascript
const CONFIG = {
  gridCompletenessThreshold: 0.8,  // Minimum % of grid filled
  maxOrphanedProperties: 2,        // Max allowed orphaned properties
  ignoreProperties: ['instanceSwap'], // Properties to ignore
  autoFixSuggestions: true         // Show fix suggestions
};
```

## Understanding Results

### Issue Types
- **Sparse Grid**: Missing too many variant combinations
- **Orphaned Property**: Property only works in specific contexts
- **Excessive Missing**: Too many missing combinations (>10)

### Severity Levels
- **High**: Critical architectural issues requiring immediate attention
- **Medium**: Design debt that should be addressed
- **Low**: Minor optimization opportunities

### Suggestions
- **Split Component**: Break into multiple focused components
- **Add Variants**: Fill missing combinations if reasonable
- **Consolidate Properties**: Reduce complexity

## Best Practices

### Clean Component Architecture
1. **Orthogonal Properties**: Each variant property should be independent
2. **Complete Grids**: Aim for >80% grid completeness
3. **Focused Scope**: Each component should have a single, clear purpose
4. **Limited Complexity**: Max 4 variant properties per component

### When to Split Components
- More than 2 orphaned properties
- Grid completeness below 50%
- Properties that only work together in specific combinations
- Different use cases requiring different property sets

## Troubleshooting

### Common Issues
- **No components found**: Make sure you're scanning pages with component sets (not just components)
- **Plugin won't load**: Check that all files are in the same folder
- **Incorrect results**: Verify component variants are properly set up in Figma

### Performance
- Large files (>100 components) may take a few seconds to scan
- "Scan All Pages" processes every page in the file
- Results are not saved between sessions

## Technical Details

### How it Works
1. **Discovery**: Finds all component sets on selected pages
2. **Analysis**: Extracts variant properties and builds theoretical grid
3. **Detection**: Compares actual variants to expected combinations
4. **Reporting**: Categorizes issues and suggests improvements

### Supported Features
- Component sets with any number of variant properties
- Mixed data types (text, boolean, number values)
- Multi-page scanning
- Click-to-navigate to problematic components
- Customizable thresholds and rules

## Contributing

To modify or extend the plugin:

1. **Add New Issue Types**: Extend `categorizeIssues()` function
2. **Custom Suggestions**: Modify `generateSuggestions()` logic
3. **UI Improvements**: Edit the HTML/CSS in `ui.html`
4. **Analysis Logic**: Update core functions in `code.js`

### Development Tips
- Use `console.log()` in `code.js` for debugging (visible in Figma's dev console)
- Test with various component structures
- Consider performance for large files
- Follow Figma's plugin guidelines for UI consistency