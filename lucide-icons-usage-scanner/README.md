# Lucide Icons Usage Scanner

A Figma plugin that scans your design files for [Lucide Icons](https://lucide.dev) usage.

## Features

- **Comprehensive Detection**: Scans for all 1651 official Lucide icons
- **Smart Matching**: Detects icons by matching layer names against the official Lucide icon naming convention (e.g., "search", "chevron-down", "user-plus")
- **Size Filtering**: Only matches elements 50px or smaller (typical icon sizes: 16x16, 20x20, 24x24, 32x32)
- **Usage Summary**: Shows which icons are used and how many times
- **Full File Scan**: Scans all pages in the document

## How It Works

The plugin looks for:
1. **Instances** with names matching Lucide icon names
2. **Components** with names matching Lucide icon names
3. Elements within the typical icon size range (up to 50px)

Icons are detected by exact name match against the official Lucide icon library. For example, if you have an instance named "search" or "chevron-down", it will be detected.

## Use Cases

- **Audit icon usage**: See which Lucide icons are used across your design file
- **Migration planning**: Identify all Lucide icons when planning to switch icon libraries
- **Documentation**: Generate a list of icons used in your design system

## Installation

1. Open Figma
2. Go to **Plugins > Development > Import plugin from manifest**
3. Select the `manifest.json` file from this directory

## Usage

1. Open a Figma file containing Lucide icons
2. Run the plugin from **Plugins > Lucide Icons Usage Scanner**
3. Click "Scan File for Lucide Icons"
4. Review the results showing:
   - Total components and instances found
   - Unique icons used
   - Usage summary by icon name
   - Detailed list of all instances

## Icon Detection

The plugin detects icons based on the official Lucide naming convention:
- Kebab-case names (e.g., `arrow-right`, `file-text`, `user-plus`)
- Single word names (e.g., `search`, `home`, `star`)
- Case-insensitive matching

## License

CC By 4.0 - Obra Studio 2025
