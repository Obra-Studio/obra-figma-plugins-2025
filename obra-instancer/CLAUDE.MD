# Code requirements

Please write ES5-compatible code, no typescript, straight in code.js

# Desired product

We aim to create a plugin that generates all possible instances for your components, including every combination of variants and component properties, in a tidy table.

## Positioning of documentation

We want the documentation to be positioned behind the existing component.

From a code generation standpoint, this means we need to look at the width and height of the existing component set, rearrange the variants inside of it respecting their current position but putting them on a uniform grid. After that, we can generate the inner grid lines, outer grid lines, and labels.

## Default component set look

In terms of look, we are looking for that default component set look that is provided by Figma.

* Outer border (the border of the component instance set): A frame with a dashed border, with #9647FF as a color, 5px radius, dashed stroke with dash value of 6 and gap value of 6
* Inner grid lines: horizontal or vertical lines with a dashed border, with #9647FF as a color, dashed stroke with dash value of 3 and gap value of 3
* Labels: 12px text, again with #9647FF, documenting the variants and properties

Note that we can't add these layers directly to the component set. We need to create a wrapper frame that in the layer order lives below the component set.

## Component sizes

Component sets will have components in different sizes, but the idea is to arrange the documentation into a uniform grid.

A detection will be necessary of the largest component size per row or per column, and subsequently the right layout code will have to be generated.


# API knowledge

Important concepts when dealing with component sets.

## Component sets have components underlying, and components are actually all frames

If you need to reference frame data, check out https://www.figma.com/plugin-docs/api/FrameNode/

## Default component

You can detect the defaultVariant as part of the ComponentSetNode API.

Seee https://www.figma.com/plugin-docs/api/ComponentSetNode/

“The default variant of this component set, which is the top-left-most variant, spatially. This corresponds to the variant that would be inserted when dragging in a component set from the team library in the Figma UI.”



