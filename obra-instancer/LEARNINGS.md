# Obra Instancer - Architecture & Positioning Model Learnings

## Core Architectural Insight

The key learning from debugging the component set documentation system is that **sizing calculations must be separated into independent steps**, not pre-calculated all at once.

## The Correct Positioning Model

### Step 5: Grid-Only Sizing
- **Component set** gets resized to fit just the variant grid (no label space)
- **Wrapper frame** gets created at the same size as the component set initially
- Variants are positioned within their grid cells
- **No consideration for labels at this stage**

### Step 8: Label Accommodation  
- Labels are created and positioned **outside** the existing wrapper frame
- If needed, the wrapper frame can be expanded later to accommodate labels
- Labels exist in the parent container, not within the component set structure

## Key Technical Insights

### 1. Component Set API Constraints
- `COMPONENT_SET` nodes can **ONLY** contain `COMPONENT` children
- Cannot add `FRAME`, `LINE`, `TEXT`, or other node types directly to a component set
- This necessitates the wrapper frame architecture

### 2. Dimension Calculation Separation
```javascript
// ✅ CORRECT: Independent calculations
Step 5: gridSize = calculateGridFromVariants()
Step 5: componentSet.resize(gridSize)
Step 5: wrapperFrame.resize(gridSize)
Step 8: labels = createLabelsOutsideWrapper()

// ❌ WRONG: Pre-calculating everything
Step 5: totalSize = gridSize + labelSpace + padding
Step 5: componentSet.resize(totalSize) // Too large!
```

### 3. ES5 Compatibility Requirements
- Figma plugins run in ES5 environment
- No `const`/`let` (use `var`)  
- No template literals (use string concatenation)
- No arrow functions (use `function() {}`)
- No `Array.from()` or modern array methods

### 4. Frame Hierarchy Architecture
```
✅ CORRECT Architecture:
WrapperFrame (purple border, handles labels)
└── ComponentSet (invisible, just container)
    ├── Component (variant 1)
    ├── Component (variant 2) 
    └── Component (variant N)

❌ WRONG Architecture:
ComponentSet
├── WrapperFrame  ❌ (API violation)
└── GridLines     ❌ (API violation)
```

### 5. Step Function Design Pattern
- Each step should work with **cumulative data storage**
- Steps should be **independently executable**
- Avoid calling original functions with parameter mismatches
- Re-extract variant data when actual component objects are needed (stored data loses references)

## Critical Bugs Avoided

### 1. Size Inflation Bug
- **Problem**: Pre-calculating label space made component sets too large
- **Solution**: Calculate grid size first, add labels later
- **Learning**: Don't mix concerns across steps

### 2. Undefined Variable Errors
- **Problem**: Old code blocks with removed variables (`frameWidth`, `labelSpaceLeft`)
- **Solution**: Clean separation of old/new implementations
- **Learning**: Incremental refactoring can leave dangerous remnants

### 3. Component Dimension Access
- **Problem**: `variant.component.width` was undefined
- **Solution**: Components are frames - use `getComponentDimensions()` helper
- **Learning**: Always use safe accessors with fallbacks

## Implementation Guidelines

### Do ✅
- Calculate grid dimensions based on actual component sizes
- Use adaptive padding based on component dimensions  
- Separate grid calculation from label positioning
- Re-extract variant data when you need actual component objects
- Use wrapper frame architecture for API compliance

### Don't ❌
- Pre-calculate label space in grid sizing steps
- Mix ES6+ features in plugin code
- Try to add non-component nodes to component sets
- Assume stored variant data has component object references
- Let old code blocks linger during refactoring

## Performance Insights

### Efficient Cell Padding
```javascript
// Adaptive padding prevents excessive white space
var adaptivePadding = Math.max(32, Math.min(CELL_PADDING, componentWidth * 0.8));
```

### Safe Dimension Access
```javascript
function getComponentDimensions(component) {
  var width = component.width;
  var height = component.height;
  
  // Fallback to absoluteBoundingBox if direct props undefined
  if (width === undefined || height === undefined) {
    if (component.absoluteBoundingBox) {
      width = component.absoluteBoundingBox.width;
      height = component.absoluteBoundingBox.height;
    }
  }
  
  // Final fallback to avoid NaN calculations
  if (width === undefined || width === null) width = 100;
  if (height === undefined || height === null) height = 40;
  
  return { width: width, height: height };
}
```

## Future Architecture Decisions

When adding new features to the component documentation system:

1. **Always separate concerns**: Grid sizing ≠ Label positioning ≠ Styling
2. **Use the wrapper pattern**: Never try to modify component set structure directly
3. **Plan for incremental execution**: Each step should be independently runnable
4. **Test with actual dimensions**: Don't rely on fallback values in testing
5. **Consider the API constraints**: Figma's node hierarchy rules are strict

This separation of concerns and understanding of the API constraints is fundamental to building robust Figma plugins that manipulate component set documentation.