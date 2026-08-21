# Model and Projection

## Compose the authored model

Complete the [Assembly authoring](assemblyAuthoring.md) and [set-out ownership](setoutAndDimensions.md) passes before composing the full Model.

- Give every reusable Family and Assembly one primary TSX file with validated typed props and definition-owned semantics.
- Represent major Occurrences explicitly. Generate only genuine regular patterns procedurally, and still assign every occurrence a deterministic Semantic Key.
- Compose parent-relative nested rigid Frames; test key paths, counts, frame composition, containment intent, and repeated-definition reuse.
- Keep dimensions and Datums in definitions, set-out in occurrence Frames, and source evidence outside the product.

Reconcile authored and source hierarchies before export. Nested civil spatial aggregation is an independent capability gate, not a geometry detail.

After the model exports, run the [authored-cleanliness pass](authoredCleanliness.md). Projection-visible materials and relationships are not dead merely because they leave the B-Rep unchanged.

## Project through the public seam

Prefer:

```text
brepjs-families → CSG IR → familiesToBim → IFC
```

Projection dispatches from definition-owned Engineering Semantics, consumes resolved Frames, derives deterministic generated identity from Semantic Key paths, and preserves typed products, aggregation, containment, materials, and quantities. Do not dispatch on display names or inspect geometry transforms to recover placement.

Use direct `BimModel` APIs only when the public adapter cannot express a proven requirement. Record every fallback:

| Field                | Required record                                                       |
| -------------------- | --------------------------------------------------------------------- |
| Source requirement   | The hierarchy, product, representation, or relationship needed        |
| Attempted public API | Exact current Interface and structured failure/insufficiency          |
| Achieved result      | What the fallback preserves and loses                                 |
| Workaround           | Smallest isolated direct-API use                                      |
| Owning layer         | Families, Projection, BIM model, writer, kernel, or Reference Harness |
| Severity             | Blocking, fidelity loss, or maintainability debt                      |
| Proposed improvement | Smallest compatibility-preserving API addition                        |

Do not modify library code solely to hide a reconstruction gap. A broad direct projector is a broad fallback even if one missing hierarchy route motivated it; report all collateral bypasses.

## Export acceptance

- Export the required schema/version and physical units.
- Validate product classes, containment, aggregation, material association, quantities, representation kinds, and deterministic generated GlobalIds.
- Run the repository-supported IFC validator with zero errors, then reimport the emitted file and assert the same public evidence.
- Compare authored parametric intent and exported SPF representation meaning separately. A parametric TSX Family may still serialize as tessellation.
- Keep validation, reimport, and ordinary export independent of the Reference IFC.

On failure, repair the smallest responsible definition, Assembly, Projection route, BIM model validation, or writer. Never patch the reference or relax an acceptance threshold.
