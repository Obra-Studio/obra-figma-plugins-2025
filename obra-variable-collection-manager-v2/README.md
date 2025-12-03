# Obra Variable Collection Manager

## The problem we faced

We created separate collections for:

1. Border radius
2. Spacing
3. Colors
4. Shadows

At one point in our project, we felt like it would be easier if all of these would be in a single collection called “Theme”.

However, you might have noticed yourself that it's not that easy or even possible in the default Figma UI to move groups across collections. 

That was the start of this plugin: this plugin allows you to merge collections into other collections.

## The evo

Along the way, we realized our architecture was actually correct, but we wanted to move groups to other places, or split collections into two.

We are eagerly awaiting variable authoring improvements Figma promised, but haven't seen the evolutions ship.

## How it works

* Merge: Select one target collection to merge into, and multiple source collections.
* Split: Extract groups into new collection
* Move: Move single group into a new collection

## DISCLAIMER

Please apply this plugin on a test file to make sure you are not messing up your entire variable. 

## Advice before you merge

Make sure you have the same amount of modes in your target collection as in your source collections. The plugin will automatically fill in missing values as “String value” or “0” but to avoid needless work, make sure you match the modes across collections.

We allow you to merge without doing this, but be aware skipping this step leads to manual work that can be avoided.