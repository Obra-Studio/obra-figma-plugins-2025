# Critical Technical Implementation Constraints

## Figma API Limitations

### COMPONENT_SET Node Restrictions
- **COMPONENT_SET nodes can ONLY contain COMPONENT children**
- You CANNOT add FRAME, LINE, TEXT, or any other node types to a COMPONENT_SET
- Attempting to do so will throw: `"Cannot move node. A COMPONENT_SET node cannot have children of type other than COMPONENT"`

### Correct Architecture Pattern
```
WrapperFrame (handles total space + labels + grid lines)
└── ComponentSet (resized to fit grid, positioned within wrapper)
    ├── Component (variant 1)
    ├── Component (variant 2) 
    └── Component (variant N)
```

### INCORRECT Architecture (Will Fail)
```
ComponentSet
├── WrapperFrame  ❌ (COMPONENT_SET can't contain FRAME)
└── GridLines     ❌ (COMPONENT_SET can't contain LINE)
```

### Implementation Steps
1. Calculate required dimensions for grid + labels
2. Create wrapper frame in same parent as component set
3. Move component set INTO wrapper frame 
4. Resize component set to grid area size
5. Position component set within wrapper (accounting for label space)
6. Add grid lines and labels to wrapper frame
7. Apply styling to component set (purple dashed border)

### Layer Stacking Order
- Grid lines and labels exist in wrapper frame
- Component set contains only the variants
- Wrapper frame handles total dimensions and positioning
- Component set is styled to look like default Figma component set

## JavaScript Environment Constraints

### ES5 Compatibility Required
- No `const` or `let` declarations (use `var`)
- No template literals (use string concatenation: `"text " + variable`)
- No arrow functions (use `function() {}` syntax)
- No `Array.from()` or modern array methods
- No `Set` objects (use arrays with manual deduplication)
- No optional chaining `obj?.prop` (use `obj && obj.prop`)

### Step Function Architecture for UI
- Step functions must work with cumulative data storage pattern
- Each step receives `existingData` object with accumulated results
- Avoid calling original functions with parameter mismatches
- Each step should be self-contained and independently executable
- Return objects that merge into `existingData` for subsequent steps

### Common Implementation Pitfalls
- Don't try to modify COMPONENT_SET children directly with non-COMPONENT nodes
- Don't pass wrong parameter counts to existing functions
- Don't use ES6+ features (will cause "not a function" or syntax errors)
- Don't assume UI step functions match original function signatures
- Don't forget that component set IS the documentation, wrapper is just infrastructure

## Error Patterns to Avoid

### "Cannot move node" Error
```javascript
// ❌ WRONG - This will fail
componentSet.appendChild(gridLine);
componentSet.appendChild(wrapper);

// ✅ CORRECT - This works
wrapperFrame.appendChild(componentSet);
wrapperFrame.appendChild(gridLine);
```

### "not a function" / "forEach of undefined" Errors
```javascript
// ❌ WRONG - Parameter mismatch
analyzeProperties(variants); // Function expects (variants, propertyNames)

// ✅ CORRECT - All parameters provided
analyzeProperties(variants, propertyNames);
```

### ES6 Syntax Errors
```javascript
// ❌ WRONG - ES6 features
const data = `Value: ${variable}`;
const items = Array.from(set);
items.forEach(item => processItem(item));

// ✅ CORRECT - ES5 compatible
var data = "Value: " + variable;
var items = [];
set.forEach(function(item) { items.push(item); });
items.forEach(function(item) { processItem(item); });
```

This document should be referenced to avoid repeating the same architectural and compatibility mistakes.