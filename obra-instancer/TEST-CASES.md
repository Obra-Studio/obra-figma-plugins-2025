# Test Cases for Manual Testing

## Quick Test Component Sets to Create in Figma

### Test Case 1: Simple Single Property
**Create a component set with:**
- Component name: `Button`
- Property: `Size`
- Variants: `Small`, `Medium`, `Large`
- Expected: 3x1 grid with size labels

### Test Case 2: Double Boolean  
**Create a component set with:**
- Component name: `Checkbox`
- Properties: 
  - `Checked`: `True`, `False`
  - `Disabled`: `True`, `False`
- Expected: 2x2 grid with boolean labels

### Test Case 3: Triple Boolean (8 variants)
**Create a component set with:**
- Component name: `Input`
- Properties:
  - `Focused`: `True`, `False`
  - `Error`: `True`, `False`  
  - `Disabled`: `True`, `False`
- Expected: 2x2 grid with additional property labels under variants

### Test Case 4: Mixed Properties
**Create a component set with:**
- Component name: `Card`
- Properties:
  - `Size`: `Small`, `Medium`, `Large` (3 values)
  - `Elevated`: `True`, `False` (2 values)
- Expected: 3x2 grid

### Test Case 5: Different Component Sizes
**Create variants with different dimensions:**
- Small button: 80x32px
- Medium button: 120x40px
- Large button: 160x48px
- Expected: Grid cells sized to largest in each row/column

## Testing Steps

1. Create component set with specified properties
2. Run Obra Instancer plugin
3. Verify:
   - ✅ Grid layout matches expected dimensions
   - ✅ Purple dashed border (#9647FF) appears
   - ✅ Grid lines are present and correctly positioned
   - ✅ Labels show correct property names and values
   - ✅ Components are centered in their cells
   - ✅ Frame is properly sized

## Error Cases to Test

1. **Select individual component** (not component set)
   - Expected: Clear error message
   
2. **Select empty component set**
   - Expected: "No variants found" error
   
3. **Select non-component object**
   - Expected: "Please select component set" error