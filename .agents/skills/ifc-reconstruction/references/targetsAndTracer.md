# Targets and tracer

## Component-local Reconstruction Targets

For each selected Semantic Key, ask the Reference Harness for source-neutral evidence. Keep two independent records:

1. A component-local `ReconstructionTarget`: physical-unit comparison surface, strongest analytic/dimensional evidence, topology, closedness, material/name evidence, and applicable observations.
2. A scene record: parent-relative `localFrame`, composed `worldFrame`, hierarchy evidence, and control placements.

A returned scene root has no omitted parent, so its local Frame equals its world Frame. Never bake source world coordinates into reusable Family geometry. Never normalize away physical dimensions.

Distill evidence into a human-authored reconstruction specification: named dimensions, engineering Datum, constraints, material, semantic kind, expected relationships, assumptions, and independent gates. The specification must be understandable without opening the Reference IFC.

## Scaffold a reference-independent product

Create the smallest authored project that exposes:

- `check`: source typecheck, focused tests, and cleanliness checks;
- `preview`: authored-model visual output with no Reference IFC;
- `export`: IFC generation with no Reference IFC;
- `compare`: a Reference Harness command that alone accepts the Reference IFC path.

Keep reference package imports out of product source and ordinary commands. Keep generated evidence under the configured reference/evidence boundary.

## Prove a tracer bullet

Choose one simple but representative leaf. Complete this seam before bulk work:

```text
manifest selection → local target + scene Frame → typed TSX Family
→ resolve/evaluate → declarative Projection → IFC export
→ validation/reimport → geometry + semantic + placement comparison
```

The tracer is complete only when:

- the Family passes its focused reference-independent contract test;
- preview and export work with the Reference IFC unavailable;
- comparison selects through the manifest rather than authored source identity;
- IFC validates and reimports through the same public Projection seam intended for the full model;
- source cleanliness and every applicable fidelity dimension pass independently.

If the tracer exposes a missing capability, record the smallest owning-layer addition. Do not bypass the intended architecture merely to start bulk authoring.
