# Set-out and authored dimensions

Run the **ownership pass** before bulk Assembly authoring and again before handoff. Its purpose is to give every calibrated number one engineering owner and keep Local Frames reviewable.

## 1. Build the number ledger

Inventory every calibrated numeric literal in authored Family, Assembly, Model, set-out, and Projection source. Assign exactly one category:

| Category                        | Owner                                                           |
| ------------------------------- | --------------------------------------------------------------- |
| Family dimension                | Typed prop or named constant beside the Family definition       |
| Assembly coordination dimension | Typed prop or named constant beside the coordinating Assembly   |
| Set-out                         | Named control or derivation in the project set-out module       |
| Projection configuration        | Projection configuration at the target boundary                 |
| Fidelity threshold              | Reference Harness validation or comparison configuration        |

A number calibrated from reference evidence still becomes authored intent; record its source and assumption in the reconstruction specification, not in runtime source.

Completion: every calibrated number has one category, one owner, and one authored name. Repeated literals reconcile to one value or document why they differ.

## 2. Author the set-out seam

The project set-out module owns civil placement controls shared across component boundaries:

- Site and Facility origins, bearings, and elevations;
- parent-relative control points for coordinated Occurrences;
- symmetric or repeated placement rules;
- derivations that locate Occurrences from named Family or Assembly dimensions.

Group controls by their parent Local Frame and use Semantic Key or engineering-role names rather than array positions. State units once. Keep the module source-neutral: plain points, bearings, elevations, and pure derivations enter authored source; Assemblies turn them into Frames.

Keep shape dimensions with the definition that gives them meaning. A set-out module is a control network, not a central component-dimension catalog. When placement depends on a dimension, pass the named dimension into a pure set-out derivation instead of copying its value.

Completion: another engineer can identify each Occurrence control, its parent Frame, and every dimension on which it depends without reading geometry operations.

## 3. Consume controls in Assemblies

Each Assembly imports the named controls it coordinates, constructs the Local Frame once, and passes typed dimensions to its children. Derive coupled values explicitly—for example, an edge railing from deck width or a bearing elevation from slab thickness—so changing one dimension moves every dependent Occurrence.

During reconstruction post-processing, search for inline `frame` and `yawFrame` origins, raw bearings, and repeated calibrated literals. Move occurrence placement to the set-out seam; promote geometry literals to typed dimensions or definition-local named constants.

Completion: every calibrated occurrence Frame is named at the set-out seam or transparently derived from named dimensions; every remaining Assembly literal is classified by the number ledger.

## 4. Verify ownership and movement

Add focused reference-independent tests that:

- assert named control points and bearings;
- assert resolved Local Frames at their owning Assembly boundary;
- vary one typed dimension and prove dependent Occurrences move together;
- preserve Semantic Keys while values change;
- keep ordinary check, preview, and export commands independent of the Reference IFC.

Run geometry and placement Fidelity Gates separately after the ownership pass. Passing geometry does not excuse an opaque or duplicated set-out model.

Completion: the ledger is reconciled, ownership tests pass, changed dimensions propagate, and fresh placement comparisons remain within their independent thresholds.
