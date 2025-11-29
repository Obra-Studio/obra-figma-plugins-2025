# Figma Var merger v2

## THE PROBLEM I FACED

I created separate collections for:
1. Border radius
2. Spacing
3. Colors
4. Shadows

At one point in our project, we felt like it would be easier if all of these would be in a single collection called “Theme”.

However, you might have noticed yourself that it's not that easy or even possible in the default Figma UI to move groups across collections. 

This is why we created this plug-in. 

## HOW IT WORKS

Select one target collection to merge into, and multiple source collections. 

## DISCLAIMER

Please apply this plugin on a test file to make sure you are not messing up your entire variable stack. 

## BEFORE YOU MERGE

Make sure you have the same amount of modes in your target collection as in your source collections. The plugin will automatically fill in missing values as “String value” or “0” but to avoid needless work, make sure you match the modes across collections.

We allow you to merge without doing this, but be aware skipping this steads leads to manual work that can be avoided.