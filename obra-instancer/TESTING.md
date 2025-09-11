# Obra Instancer - Testing Documentation

## Testing Strategy

This document outlines comprehensive test cases for the Obra Instancer plugin to ensure it handles all possible component set configurations correctly.

## Test Categories

### 1. Single Property Tests

#### 1.1 Simple Single Property (3 variants)
- **Property**: `Size` with values `Small`, `Medium`, `Large`
- **Expected Layout**: 3x1 grid (single row)
- **Expected Labels**: Column headers with size values, property name at top
- **Grid Lines**: 2 vertical lines separating columns

#### 1.2 Single Boolean Property
- **Property**: `Active` with values `True`, `False`
- **Expected Layout**: 2x1 grid
- **Expected Labels**: Column headers with boolean values
- **Grid Lines**: 1 vertical line

#### 1.3 Single Property with Many Values
- **Property**: `State` with values `Default`, `Hover`, `Active`, `Disabled`, `Loading`
- **Expected Layout**: 5x1 grid
- **Expected Labels**: 5 column headers, property name at top
- **Grid Lines**: 4 vertical lines

### 2. Two Property Tests

#### 2.1 Two Non-Boolean Properties
- **Properties**: 
  - `Size`: `Small`, `Medium`, `Large` (3 values)
  - `Variant`: `Primary`, `Secondary` (2 values)
- **Expected Layout**: 3x2 grid
- **Expected Labels**: 
  - Column headers: Size values
  - Row headers: Variant values
  - Property names on axes
- **Grid Lines**: 2 vertical, 1 horizontal

#### 2.2 Two Boolean Properties
- **Properties**: 
  - `Active`: `True`, `False`
  - `Disabled`: `True`, `False`
- **Expected Layout**: 2x2 grid
- **Expected Labels**: Boolean values on both axes
- **Grid Lines**: 1 vertical, 1 horizontal

#### 2.3 Mixed Boolean and Non-Boolean
- **Properties**:
  - `Size`: `Small`, `Medium`, `Large` (3 values - primary)
  - `Active`: `True`, `False` (2 values - secondary)
- **Expected Layout**: 3x2 grid
- **Expected Labels**: Size columns, Active rows
- **Grid Lines**: 2 vertical, 1 horizontal

### 3. Three Property Tests (Triple Booleans)

#### 3.1 Triple Boolean Properties
- **Properties**:
  - `Active`: `True`, `False`
  - `Disabled`: `True`, `False`  
  - `Loading`: `True`, `False`
- **Expected Layout**: 2x2 grid (uses first two properties for axes)
- **Expected Labels**: 
  - Axes: Active (columns), Disabled (rows)
  - Additional property labels under each variant
- **Grid Lines**: 1 vertical, 1 horizontal
- **Variants**: 8 total variants (2³)

#### 3.2 Two Properties + One Boolean
- **Properties**:
  - `Size`: `Small`, `Medium`, `Large` (3 values)
  - `Variant`: `Primary`, `Secondary` (2 values)
  - `Active`: `True`, `False` (boolean)
- **Expected Layout**: 3x2 grid
- **Expected Labels**: 
  - Axes: Size (columns), Variant (rows)
  - Active property labels under variants
- **Grid Lines**: 2 vertical, 1 horizontal

#### 3.3 One Property + Two Booleans
- **Properties**:
  - `Size`: `Small`, `Medium`, `Large` (3 values)
  - `Active`: `True`, `False`
  - `Disabled`: `True`, `False`
- **Expected Layout**: 3x2 grid
- **Expected Labels**:
  - Axes: Size (columns), Active (rows)
  - Disabled property labels under variants
- **Grid Lines**: 2 vertical, 1 horizontal

### 4. Complex Property Tests

#### 4.1 Four Properties
- **Properties**:
  - `Size`: `Small`, `Medium`, `Large`
  - `Variant`: `Primary`, `Secondary`
  - `Active`: `True`, `False`
  - `Icon`: `True`, `False`
- **Expected Layout**: 3x2 grid (largest two properties)
- **Expected Labels**: 
  - Axes: Size, Variant
  - Additional labels: Active, Icon under variants

#### 4.2 Five Properties (Edge Case)
- **Properties**:
  - `Size`: `Small`, `Medium`, `Large`
  - `Variant`: `Primary`, `Secondary`, `Tertiary`
  - `State`: `Default`, `Hover`
  - `Active`: `True`, `False`
  - `Icon`: `True`, `False`
- **Expected Layout**: 3x3 grid (Size x Variant)
- **Expected Labels**: Many additional property labels

### 5. Component Size Variation Tests

#### 5.1 Uniform Component Sizes
- All variants: 100x40px
- **Expected**: Equal cell sizes with consistent padding

#### 5.2 Mixed Component Sizes
- **Variants**:
  - Small: 80x32px
  - Medium: 120x40px  
  - Large: 160x48px
- **Expected**: 
  - Column widths: 80+pad, 120+pad, 160+pad
  - Row height: 48+pad (largest)

#### 5.3 Extreme Size Differences
- **Variants**:
  - Icon: 24x24px
  - Button: 120x40px
  - Card: 300x200px
- **Expected**: Proper cell sizing to accommodate largest in each row/column

### 6. Edge Cases

#### 6.1 Single Variant (No Properties)
- Only one component in set
- **Expected**: 1x1 grid, no labels, no grid lines

#### 6.2 No Properties (Multiple Variants)
- Multiple variants but no variant properties defined
- **Expected**: Single row layout, variants in sequence

#### 6.3 Empty Component Set
- Component set with no child components
- **Expected**: Error message, plugin stops gracefully

#### 6.4 Invalid Selection
- User selects individual component instead of component set
- **Expected**: Clear error message

### 7. Styling Tests

#### 7.1 Outer Border Styling
- **Expected**: #9647FF color, 1px weight, [6,6] dash pattern, 5px radius

#### 7.2 Inner Grid Lines
- **Expected**: #9647FF color, 1px weight, [3,3] dash pattern, 50% opacity

#### 7.3 Label Styling
- **Expected**: 12px Inter font, #9647FF color, proper alignment

## Test Implementation Strategy

### Manual Testing Checklist
Create test component sets in Figma covering each scenario above and verify:
- [ ] Correct grid layout calculation
- [ ] Proper component positioning
- [ ] Accurate label placement and content
- [ ] Correct styling application
- [ ] Frame resizing works properly

### Automated Testing (Future)
Consider implementing:
- Unit tests for grid calculation functions
- Property analysis validation
- Layout dimension calculations
- Error handling scenarios

## Test Component Set Naming Convention

Use this naming pattern for test files:
- `test-single-3variants` - Single property, 3 variants
- `test-double-boolean` - Two boolean properties
- `test-triple-boolean` - Three boolean properties
- `test-mixed-sizes` - Components with different dimensions
- `test-edge-empty` - Edge case scenarios

## Coverage Goals

- ✅ All property count scenarios (0-5+ properties)
- ✅ All property type combinations (boolean vs non-boolean)
- ✅ Component size variations
- ✅ Edge cases and error conditions
- ✅ Visual styling verification
- ✅ Performance with large component sets

## Known Limitations

Document any discovered limitations here:
- Maximum recommended variants: TBD
- Performance considerations: TBD
- Figma API constraints: TBD