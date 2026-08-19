# Use declarative composition for authored models

Authored models use TypeScript and TSX as an immutable description language: a Model composes Assemblies, Assemblies compose keyed Occurrences, and each reusable Family has one owned source file. Families are reused through typed configuration, composition, or deliberate copy-and-own adaptation rather than class inheritance. Components have no React runtime, hooks, lifecycle, reconciler, or mutable render state.

Every occurrence is placed by one parent-relative rigid Local Frame. Geometry evaluation and target Projection consume that same composed frame so there is no second placement system to reconcile. Families emit geometry and engineering semantics; Projection alone maps those semantics to IFC classes, spatial hierarchy, relationships, identifiers, and serialized output.

## Considered options

- Use imperative construction as the primary model source: rejected because hierarchy, identity, and placement become scattered across execution order rather than visible as authored structure.
- Reuse families through class inheritance: rejected because behavioral inheritance obscures geometry and makes local changes harder to trace than composition or owned copies.
- Depend on React itself: rejected because CAD authoring needs a small deterministic description runtime, not UI state or reconciliation semantics.
- Maintain separate transforms for geometry and BIM export: rejected because duplicated placement state can silently diverge.
- Put IFC class names and writer calls throughout component files: rejected because reusable engineering definitions should not be coupled to one exchange format.

## Consequences

The family runtime must treat TSX children and nested local frames as first-class authoring concepts. Semantic keys identify occurrences independently of source order. Infrastructure-aware Projection must be extended before the bridge can be represented faithfully, while component source remains phrased in engineering vocabulary.
