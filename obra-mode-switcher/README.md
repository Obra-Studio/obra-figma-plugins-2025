# Mode Switcher - Figma Plugin

A Figma plugin that scans your file for variable modes with the same name across multiple collections and lets you apply them all at once.

## The Problem

When you have multiple variable collections (e.g., colors, typography, spacing, shadows, border-radii) and each has the same mode names (e.g., "Client A", "Client B", "Client C"), switching between clients is tedious. You have to manually change each collection's mode one by one.

## The Solution

Mode Switcher scans your variable collections, finds modes that share the same name, and creates a single button to apply all of them at once.

## Installation

1. In Figma, go to **Plugins** → **Development** → **Import plugin from manifest...**
2. Select the `manifest.json` file from this folder
3. The plugin will appear in your **Plugins** → **Development** menu

## Usage

1. Run the plugin from **Plugins** → **Development** → **Mode Switcher**
2. The plugin automatically scans your file and shows all modes that appear in multiple collections
3. Select one or more frames in your file
4. Click **Apply to Selection** to apply all matching modes to selected frames
5. Or click **Apply to Page** to apply to all top-level frames on the current page

## Example

If you have:

| Collection    | Modes                           |
|---------------|--------------------------------|
| Colors        | Client A, Client B, Client C   |
| Typography    | Client A, Client B, Client C   |
| Spacing       | Client A, Client B, Client C   |
| Shadows       | Client A, Client B, Client C   |
| Border Radii  | Client A, Client B, Client C   |

The plugin will show 3 buttons:
- **Apply Client A** (5 collections)
- **Apply Client B** (5 collections)  
- **Apply Client C** (5 collections)

Each button applies all 5 modes at once!

## Features

- 🔍 Automatically detects shared mode names across collections
- ✨ Apply to selected frames or entire page
- 🔄 Real-time selection tracking
- 📋 Shows which collections each mode spans
- ⚡ Instant application with visual feedback

## File Structure

```
figma-mode-switcher/
├── manifest.json   # Plugin configuration
├── code.js         # Main plugin logic (runs in Figma)
├── ui.html         # Plugin UI (runs in iframe)
└── README.md       # This file
```

## Requirements

- Figma desktop app or Figma in browser
- A Figma file with variable collections and modes

## Notes

- The plugin only shows modes that appear in **2 or more** collections
- Modes are applied to nodes that support explicit variable modes (frames, components, sections)
- The plugin uses `setExplicitVariableModeForCollection()` which is the standard Figma API for mode switching
