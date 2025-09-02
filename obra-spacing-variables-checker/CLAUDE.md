# Obra Spacing Variables Checker - Project Context

## Overview

This is a Figma plugin that helps designers detect and apply spacing variables consistently across their designs. The plugin scans selected layers for spacing properties (gaps, padding) and suggests appropriate variables from your design system.

## Key Features

### 1. Spacing Variable Detection
- Scans for variables with GAP or WIDTH_HEIGHT scopes
- Displays all available spacing variables with their values
- Automatically loads on plugin startup

### 2. Layer Scanning
- Detects layers with spacing properties:
  - `itemSpacing` (gap in auto-layout frames)
  - `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` (individual padding)
  - `horizontalPadding`, `verticalPadding` (uniform padding)
- Identifies which properties could use variables
- Separates layers into "problems" (missing variables) and "fixed" (already using variables)

### 3. Variable Application
- Applies spacing variables directly to the detected property
- Supports all spacing property types
- Updates UI to reflect applied variables

### 4. Layer Filtering
- Ignore specific layer names (exact match)
- Persistent storage of ignored names using localStorage
- Default ignored names: 'Labels', 'Bracket', 'Instances'

## Technical Implementation

### Files
- `code.js`: Main plugin logic that interfaces with Figma API
- `ui.html`: Plugin UI with layer lists and controls
- `manifest.json`: Plugin configuration
- `README.md`: Basic documentation

### Core Functions

#### In code.js:
- `scanForSpacingVariables()`: Finds all local variables with GAP or WIDTH_HEIGHT scopes
- `findLayersWithSpacingIssues()`: Recursively scans selection for layers with spacing properties
- `hasSpacingVariable()`: Checks if a node has bound spacing variables
- `getDetailedSpacingInfo()`: Extracts all spacing values from a node
- `findMatchingVariable()`: Matches spacing values to available variables
- `applyVariableToLayer()`: Applies a variable to a specific spacing property

#### Variable Scopes:
- **GAP scope**: Can be applied to `itemSpacing` (gaps between items)
- **WIDTH_HEIGHT scope**: Can be applied to padding properties

### UI Components
- Variables list showing all available spacing variables
- Problem layers accordion (layers missing variables)
- Fixed layers accordion (layers already using variables)
- Selected layer details with apply button
- Ignore list management

## Usage Flow

1. **Select layers** in Figma to scan
2. **Click "Scan Selected Layers"** to find spacing issues
3. **Review results** separated into problems and fixed layers
4. **Click on a layer** to navigate to it in Figma
5. **Click "Apply"** to apply the suggested variable to the detected property

## Data Structures

### Layer Issue Object:
```javascript
{
  id: node.id,
  name: node.name,
  type: node.type,
  spacingValue: number,           // The numeric spacing value
  spacingProperty: string,        // e.g., 'itemSpacing', 'paddingTop'
  propertyType: 'gap' | 'padding',
  hasVariable: boolean,
  issueType: 'missing_variable' | 'no_matching_variable' | 'has_variable',
  matchingVariable: variable,     // If a matching variable exists
  suggestion: {
    type: string,
    message: string,
    property: string,              // The specific property to apply to
    propertyType: string
  },
  spacingInfo: object             // Full spacing details
}
```

## Testing Approach
- Create test frames with auto-layout and various spacing values
- Define spacing variables in Figma (4px, 8px, 12px, 16px, 24px, etc.)
- Test variable application to different spacing properties
- Verify the plugin correctly identifies matching variables
- Test with both GAP and WIDTH_HEIGHT scoped variables

## Commands
No build commands required - plugin runs directly in Figma's development environment.