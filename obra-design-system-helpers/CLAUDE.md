# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Figma plugin called "Obra Design System Helpers" that provides UI automation for common design system tasks. The plugin is built in vanilla JavaScript without external dependencies and follows Obra's design system guidelines.

## Architecture

The plugin follows standard Figma plugin architecture with two main components:

- **code.js**: Main plugin logic that runs in Figma's sandbox, handles UI messages and manipulates Figma nodes
- **ui.html**: Plugin UI with organized sections, buttons, guidelines, and status messaging
- **manifest.json**: Plugin configuration with menu commands for direct access to key features

The plugin supports both UI-driven interactions and direct menu commands for common operations.

## Key Functions

### Core Functions (code.js)
- `handleRenameLayer()`: Renames selected layers to standardized names (code.js:46)
- `handleSetSpacing()`: Sets auto layout spacing and gaps on selected frames (code.js:73)
- `handleSetFrameSpacing()`: Sets 256px spacing between top-level frames (code.js:145)
- `handleDeprecateComponent()`: Adds deprecation prefix to component names (code.js:209)
- `handleVisualDeprecateComponent()`: Adds red overlay to components for visual deprecation (code.js:247)
- `handleWrapInSection()`: Wraps components in properly formatted section frames (code.js:348)
- `handleMarkStopFrame()`: Adds stop emoji prefix to frame names (code.js:429)
- `handlePostPropstarTreatment()`: Organizes Propstar generated documentation (code.js:467)
- `handlePropStarCleanup()`: Removes Prop Star elements and ungroups frames (code.js:570)
- `handleSet32pxInnerSpacing()`: Sets 32px padding and gap for component variants (code.js:650)
- `handleResetComponentSetStyle()`: Resets component sets to default styling (code.js:804)
- `handleDetectComponents()`: Scans for component violations in screen designs (code.js:868)

## Plugin Features

### Layer Renaming
- Rename to "AL": For generic auto layout layers
- Rename to "Section": For component documentation layers

### Component Deprecation
- Text deprecation: Adds "🛑DEPRECATED - " prefix to component names
- Visual deprecation: Adds 20% opacity red overlay to all component variants
- Handles both individual components and component sets

### Spacing Management
- 64px spacing + 32px gap: For individual sections/component documentation
- 0px spacing + 0px gap: For top-level frames (spacing contained in sections)
- 256px spacing between top-level frames (vertical and horizontal)
- 32px inner spacing: For component variants (padding and gap)

### Component Organization
- Wrap in section: Creates properly formatted documentation sections with heading text
- Mark frames: Adds stop emoji (🛑) prefix for organizational purposes

### Propstar Integration

- Post-treatment: Provide a helper after generating Propstar documentation that repositions the original component
- Cleanup: Removes Propstar generated elements (Labels group, Instances frame) and ungroups documentation to provide a clean slate

### Screen Design Validation
- Component detection: Scans selected frames for component violations (only hidden components starting with . or _ allowed)

### Component Set Styling
- Reset to default styling (transparent background, #9747FF dashed border) for better designer experience

### Design Guidelines Enforced
- Auto layout frames use consistent naming conventions
- Section layers have 64px outer spacing with 32px gaps
- Top-level frames have no spacing (contained within sections)
- 256px spacing between top-level frames
- Component variants use 32px inner spacing
- Component sets use default purple styling for consistency

## User Interface

The UI is organized into logical sections:
- General: Basic layer operations
- Screen design validation: Component violation detection for screen designs
- Component deprecation: Text and visual deprecation tools
- Individual sections: Section-specific operations and wrapping
- Spacing between frames: Inter-frame spacing management
- Top level frames: Top-level frame operations
- Component variant helpers: Variant-specific tools
- Component properties documentation: Prop Star workflow integration

Features collapsible guidelines that explain the purpose of each operation.

## Menu Commands

Direct access commands available via Figma's plugin menu:
- Show UI: Opens the main plugin interface
- Post-Prop Star Treatment: Direct access to post-Prop Star organization
- De-Propstar: Direct cleanup of Prop Star elements
- Set 256px Vertical Spacing: Direct vertical spacing between selected frames
- Reset Component Set Style: Direct reset to default component set styling

## Development

No build process required - this is vanilla JavaScript. To test changes:

1. Load plugin in Figma via Plugins > Development > Import plugin from manifest
2. Make changes to code.js or ui.html
3. Reload plugin in Figma to see changes

The plugin requires selection of appropriate node types (FRAME, COMPONENT, INSTANCE, COMPONENT_SET) with auto layout enabled for most spacing operations.