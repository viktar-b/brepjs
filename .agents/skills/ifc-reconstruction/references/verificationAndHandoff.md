# Verification and handoff

## Run independent gates

Never compress acceptance into one similarity score. For every scoped occurrence, compare:

- geometry: dimensions, local bounds, surface distance distribution, normal agreement, volume, IoU, and curved-profile evidence where applicable;
- placement: origin/control points and Frame axes, independently from local geometry;
- hierarchy and relationships: aggregation, containment, nesting, and parent paths;
- semantics: IFC class, engineering kind/role, material, typed attributes, properties, quantities, and names;
- identity: stable Semantic Key and deterministic generated GlobalId, with source identity policy reported separately;
- serialization: schema, units, representation kind, validation, and successful reimport;
- coverage: scoped products and all placed non-spatial source objects as separate denominators;
- visual fidelity: matched-camera source/output renders plus useful overlay or difference views, approved separately by a human.

Decorative text or font mismatch is a visual-fidelity exception unless evidence also shows a placement failure. Do not relabel it. Rerun measured gates after every repair; do not reuse stale values.

## Reconcile IFC document fidelity

Complete the IFC Document Fidelity/Capability Profile from intake with measured source/output evidence. Excellent scoped solids do not establish schema dialect, units, CRS, full spatial shell, CompositionType, styles, type objects, properties/quantities, civil attributes, identity policy, or representation equivalence.

If no row passes, state **no reconstruction level accepted** and list the blocking gates. Otherwise choose exactly one highest-supported classification. Each higher level includes all evidence required by the rows above it:

| Classification                    | Minimum evidence                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scoped geometric reconstruction   | Declared scoped solids pass geometry and placement gates; omissions are explicit.                                                                                   |
| Scoped semantic/product model     | Geometry plus scoped class, hierarchy, relationships, material, semantic key, identity policy, and IFC reimport pass.                                               |
| Federation-compatible replacement | Whole placed-object coverage and federation-critical spatial shell, units, CRS/map conversion, identity/placement, types/styles needed by consumers are compatible. |
| Drop-in IFC-document replacement  | Whole-file scope and every applicable document-profile row are equivalent or accepted by named downstream consumers with no silent loss.                            |

Never claim “drop-in replacement” from scoped geometry alone. One hundred percent scoped products with incomplete whole-file coverage cannot exceed its independently supported document classification.

## Produce the gap matrix

For every omission or fallback report: source requirement; attempted current API; achieved result; workaround; missing capability and owning layer; severity; and proposed smallest API improvement. Distinguish exact reconstruction, parametric intent, exported representation, visual approximation, scoped omission, and unsupported document semantics.

## Handoff

Include:

- configured paths and reproducible commands;
- architecture and authored layout;
- source/output inventory and both capability profiles;
- per-gate pass/fail table with fresh measured values;
- matched-camera visual artifacts and approval status;
- IFC validation/reimport evidence;
- fallback register and gap matrix;
- final classification with supporting evidence and limitations;
- commits and dirty-tree audit;
- prototype-retirement decision.

A prototype is safe to retire only when the current Reference Harness and reports preserve every still-needed forensic capability and the authored project has no dependency on it. Do not delete it without explicit authority.
