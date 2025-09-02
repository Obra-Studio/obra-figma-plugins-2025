# Obra Figma Plugins 2025 - Project Context

## Overview

This repository contains a collection of Figma plugins developed by Obra Studio to streamline design system workflows and automate common design tasks. All plugins are built in vanilla JavaScript without external dependencies and follow consistent architectural patterns.

## Project Structure

The repository contains 10 Figma plugins, each in its own directory:

### Core Design System Plugins
- **`obra-design-system-helpers/`**: Comprehensive design system automation (spacing, deprecation, organization)
- **`obra-spacing-variables-checker/`**: Detects and applies spacing variables consistently
- **`obra-component-validator/`**: Validates component structure and naming conventions
- **`obra-border-radius-checker/`**: Checks and applies border radius variables

### Variable Management Plugins
- **`obra-var-replacer/`**: Replaces text values with design system variables
- **`obra-variable-reference-cleaner/`**: Cleans up unused variable references
- **`obra-library-scanner/`**: Scans libraries for variable usage and inconsistencies

### Utility Plugins
- **`obra-hexxer/`**: Extracts hex color values from designs
- **`obra-instancer/`**: Creates instances from components
- **`component-title-case-checker/`**: Ensures component names follow title case conventions

## Common Plugin Architecture

All plugins follow a consistent structure:

### Standard Files
- **`code.js`**: Main plugin logic that runs in Figma's sandbox
- **`ui.html`**: Plugin UI (when interactive interface is needed)  
- **`manifest.json`**: Plugin configuration and metadata
- **`README.md`**: Basic plugin documentation
- **`CLAUDE.md`**: Detailed context for AI assistance (when present)

### Plugin Types

1. **UI Plugins**: Include both code.js and ui.html for interactive workflows
   - obra-design-system-helpers
   - obra-spacing-variables-checker
   - component-title-case-checker

2. **Menu Command Plugins**: Execute directly via Figma menu without UI
   - obra-hexxer (Extract Hex Colors)
   - obra-instancer
   - obra-var-replacer

3. **Hybrid Plugins**: Support both UI and direct menu commands
   - obra-design-system-helpers (extensive menu commands)

### Common Patterns

#### Manifest Structure
```json
{
  "name": "Plugin Name",
  "id": "plugin-id",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",  // Optional for UI plugins
  "menu": [         // Optional menu commands
    {
      "name": "Command Name",
      "command": "command-id"
    }
  ],
  "capabilities": [],
  "enableProposedApi": false,
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": ["none"]
  }
}
```

#### Code Structure
- Message handling between UI and plugin code
- Node traversal and manipulation using Figma API
- Variable detection and application
- Selection validation and error handling

## Development Workflow

### No Build Process Required
All plugins use vanilla JavaScript and run directly in Figma's development environment.

### Testing Process
1. Load plugin in Figma via **Plugins > Development > Import plugin from manifest**
2. Make changes to code.js or ui.html
3. Reload plugin in Figma to see changes
4. Test with appropriate node types and selections

### Common Testing Scenarios
- Test with various node types (FRAME, COMPONENT, INSTANCE, COMPONENT_SET)
- Test with and without auto layout enabled
- Test variable detection and application
- Test error handling for invalid selections

## Design System Guidelines Enforced

The plugins collectively enforce Obra's design system standards:

### Spacing Standards
- **64px outer spacing + 32px gaps**: For component documentation sections
- **0px spacing + 0px gaps**: For top-level frames (spacing contained in sections)
- **256px spacing**: Between top-level frames (vertical and horizontal)
- **32px inner spacing**: For component variants (padding and gap)

### Component Standards
- Title case naming conventions
- Proper deprecation workflows (text and visual)
- Component validation and violation detection
- Consistent variable application

### Variable Management
- Automatic detection of spacing, color, and other design tokens
- Consistent application across design files
- Cleanup of unused references
- Library scanning for consistency

## Plugin-Specific Features

### obra-design-system-helpers
- Layer renaming automation
- Component deprecation (text and visual)
- Spacing management at multiple levels
- Propstar integration for documentation
- Component set styling reset

### obra-spacing-variables-checker
- Variable detection with GAP and WIDTH_HEIGHT scopes
- Layer scanning for spacing properties (itemSpacing, padding)
- Automatic variable suggestions and application
- Layer filtering and ignore list management

### obra-component-validator
- Component structure validation
- Naming convention enforcement
- Design system compliance checking

## License and Attribution

**License**: CC By 4.0  
**Copyright**: ©Obra Studio 2025  
**URL**: https://creativecommons.org/licenses/by/4.0/

## Development Notes

- All plugins are "vibe-coded" with focus on practical utility
- No external dependencies or build processes
- Consistent error handling and user feedback
- Designed for daily use in production design workflows
- Each plugin solves specific design system challenges identified by Obra's design team

## Commands

No build commands required. All plugins run directly in Figma's development environment.

To test any plugin:
1. Open Figma
2. Go to Plugins > Development > Import plugin from manifest
3. Navigate to the specific plugin directory and select manifest.json
4. Plugin will be available in the Plugins menu for testing