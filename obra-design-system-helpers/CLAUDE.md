# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Figma plugin called "Obra Design System Helpers" that provides UI automation for common design system tasks. The plugin is built in vanilla JavaScript without external dependencies and follows Obra's design system guidelines.

## Architecture

The plugin follows standard Figma plugin architecture with two main components:

- **code.js**: Main plugin logic that runs in Figma's sandbox, handles UI messages and manipulates Figma nodes
- **ui.html**: Plugin UI with buttons and status messaging, communicates with main code via postMessage

Key functions:
- `handleRenameLayer()`: Renames selected layers to standardized names (code.js:15)
- `handleSetSpacing()`: Sets auto layout spacing and gaps on selected frames (code.js:42)

## Plugin Features

### Layer Renaming
- Rename to "AL": For generic auto layout layers
- Rename to "Section": For component documentation layers

### Spacing Management
- 64px spacing + 32px gap: For individual sections/component documentation
- 0px spacing + 0px gap: For top-level frames (spacing contained in sections)

### Design Guidelines Enforced
- Auto layout frames should use consistent naming conventions
- Section layers need 64px outer spacing with 32px gaps
- Top-level frames should have no spacing (contained within sections)
- 256px spacing between top-level frames (not yet implemented)

## Development

No build process required - this is vanilla JavaScript. To test changes:

1. Load plugin in Figma via Plugins > Development > Import plugin from manifest
2. Make changes to code.js or ui.html
3. Reload plugin in Figma to see changes

The plugin requires selection of appropriate node types (FRAME, COMPONENT, INSTANCE) with auto layout enabled for spacing operations.