# Regression Test — Layer Thickness Parsing (top/middle/bottom)

## Goal
Ensure multi-layer emails that describe thicknesses using:
- "bottom layer"
- "middle layer"
- "top layer"
…correctly map to numeric layers (Layer 1..N) and do NOT default top to 1".

## Known failure mode (historical)
Top layer thickness was parsed but later overwritten/defaulted to 1" due to merge/memory/LLM ordering.
Fix ensures a final canonical pass sets `layer_thicknesses` as a full numeric array (length = layer_count)
before building the layout editor URL.

## Test Inputs
Use /api/ai/orchestrate dryRun with these three cases:

### Case A: 3 layers with explicit top thickness
- (3) 10"x10" layers
- bottom = 1.5"
- middle = 3" with cavities
- top = 2"

Expected:
- facts.layer_count = 3
- facts.layer_thicknesses = [1.5, 3, 2]
- layout_editor_url contains:
  - layer_count=3
  - layer_thicknesses=1.5
  - layer_thicknesses=3
  - layer_thicknesses=2

### Case B: includes ".5" notation
Expected:
- ".5" canonicalizes to "0.5" in facts and URL.

### Case C: "Layer 3" wording instead of "top layer"
Expected:
- Same result as Case A.

## Pass/Fail
PASS if facts.layer_thicknesses matches expected array AND layout_editor_url includes repeated
layer_thicknesses params matching those values.
FAIL if top layer becomes 1" when email says otherwise.
