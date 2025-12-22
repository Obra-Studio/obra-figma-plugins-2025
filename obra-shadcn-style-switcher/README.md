# shadcn/ui Theme Switcher for Figma

A Figma plugin to switch between shadcn/ui's 5 official themes (Vega, Nova, Maia, Lyra, Mira) by modifying your variable collections.

## Theme Comparison

Data extracted from official shadcn/ui CSS files:

| Property | Vega | Nova | Maia | Lyra | Mira |
|----------|------|------|------|------|------|
| **Default Button** | h-9 (36px) | h-8 (32px) | h-9 (36px) | h-8 (32px) | h-7 (28px) |
| **Small Button** | h-8 (32px) | h-7 (28px) | h-8 (32px) | h-7 (28px) | h-6 (24px) |
| **XS Button** | h-6 (24px) | h-6 (24px) | h-6 (24px) | h-6 (24px) | h-5 (20px) |
| **Large Button** | h-10 (40px) | h-9 (36px) | h-10 (40px) | h-9 (36px) | h-8 (32px) |
| **Button Radius** | rounded-md | rounded-lg | rounded-4xl (pill) | rounded-none | rounded-md |
| **Input Height** | h-9 | h-8 | h-9 | h-8 | h-7 |
| **Card Radius** | rounded-xl | rounded-xl | rounded-2xl | rounded-none | rounded-lg |
| **Dialog Radius** | rounded-xl | rounded-xl | rounded-2xl | rounded-none | rounded-xl |
| **Menu Item Radius** | rounded-sm | rounded-sm | rounded-xl | rounded-none | rounded-md |
| **Checkbox Radius** | 4px | 4px | 6px | 0px | 4px |
| **Focus Ring** | ring-[3px] | ring-[3px] | ring-[3px] | ring-1 | ring-[2px] |
| **Base Text** | text-sm | text-sm | text-sm | text-xs | text-xs |
| **Overlay** | black/10 | black/10 | black/80 | black/10 | black/80 |

## Theme Personalities

### Vega (Default)
Classic shadcn/ui appearance. Standard proportions and balanced spacing.
- Standard border radii (rounded-md for controls)
- Default Tailwind spacing scale
- Balanced, professional look

### Nova (Compact)
Space-efficient with tighter proportions.
- Same radii as Vega
- Smaller heights (-1 step: h-8 default buttons)
- Tighter padding and gaps

### Maia (Soft)
Rounded and approachable with generous whitespace.
- Pill-shaped buttons (rounded-4xl)
- Larger radii throughout (+1 step)
- More padding, bigger gaps
- Heavier shadows (shadow-2xl)
- Darker overlays (black/80)

### Lyra (Boxy)
Brutalist aesthetic with sharp edges.
- No border radius (rounded-none)
- Compact spacing (same as Nova)
- Thinner focus rings (ring-1)
- Smaller text (text-xs)

### Mira (Dense)
Most compact theme for data-heavy UIs.
- Smallest buttons (h-7 default)
- Slightly smaller radii (-1 step)
- Most compact spacing (-2 steps)
- Medium focus rings (ring-[2px])
- Smaller text (text-xs)

## Installation

1. Download the plugin files
2. In Figma: Plugins → Development → Import plugin from manifest
3. Select the `manifest.json` file

## Usage

1. Open a Figma file with shadcn/ui variable collections
2. Run the plugin: Plugins → shadcn/ui Theme Switcher
3. Select a theme and click "Apply Theme"

## Requirements

Your Figma file needs variable collections with semantic tokens:

### Border Radius Collection
Variables named like: `rounded-xs`, `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-4xl`, `rounded-full`

### Spacing Collection  
Variables named like: `3xs`, `2xs`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `4xl`, `5xl`

The plugin will match variables by name patterns and update their values (or aliases) according to the selected theme.

## How It Works

The plugin modifies semantic variables to point to different absolute values:

**Example: Button border radius**
- Vega: `rounded-md` → 6px
- Nova: `rounded-lg` → 8px  
- Maia: `rounded-4xl` → 9999px (pill)
- Lyra: `rounded-none` → 0px
- Mira: `rounded-md` → 6px

**Example: Default spacing**
- Vega: `md` → 20px
- Nova: `md` → 16px (-1 step)
- Maia: `md` → 24px (+1 step)
- Lyra: `md` → 16px (-1 step)
- Mira: `md` → 12px (-2 steps)

## Files

- `manifest.json` - Plugin configuration
- `code.js` - Plugin logic with theme definitions
- `ui.html` - Plugin interface

## Notes

- Theme data extracted from official shadcn/ui CSS files (style-vega.css, style-nova.css, style-maia.css, style-lyra.css, style-mira.css)
- The plugin updates variable values, not component definitions
- Works best with properly structured variable collections
- Backup your file before applying themes
