# ADR-0001: Independent Classification, Geometry representation, and Placement

**Status**: Proposed
**Date**: 2026-09-10
**Authors**: Viktar, with Codex

## Context

Adding IfcSign with an existing solid representation required repeated registration in geometry disposal, Placement, validation, and adapters. The reviewed change touched 24 files for 412 additions and 66 deletions. Tests and semantic mappings legitimately explain some of that spread; repeated registration of unchanged geometry behavior exposes the architectural coupling.

At the [reviewed upstream baseline](../architecture-evidence.md#evidence-baselines), `BimModel` combines record ownership, recipe generation, and IFC concerns. Wall and Railing have a shared `ProductBody`, while other classes retain separate geometry paths. These are source observations, not a claim that the proposed architecture has shipped.

This package-local ADR series follows the [BIM glossary](../../CONTEXT.md). Its numbering is independent of the root series. It preserves accepted constraints: independent Classification, Geometry representation, and Placement; one monorepo and one BIM npm package; prototype breaking changes without compatibility aliases or a permanent facade. The extracted records remain Proposed where review is outstanding.

## Decision

A physical element records Classification, Geometry representation, and Placement independently. A closed semantic map validates legal class, payload, role, representation, and relationship combinations. It contains no geometry lifecycle callbacks.

The document validates the neutral domain graph before committing changes: endpoints exist, belong to the document, and satisfy the supported relationship's category, cardinality, and cycle rules. Invalid relationships cannot disappear during export as a substitute for rejection. IFC inheritance, inherited attributes, and schema-specific constraints belong to [ADR-0006](0006-ifc-exchange-adapter.md); the neutral document does not mirror the IFC inheritance tree.

The neutral document owns records, identity, relationships, metadata, appearance assignments, Placement references, and adopted geometry. It provides atomic insertion/replacement, queries, Placement changes and record deletion under [ADR-0004](0004-document-resolved-placement-and-datum.md), and final disposal. It does not parse recipes, generate class-specific geometry, or import Families or IFC runtime types.

Authoring validates recipes and class-specific rules, generates local geometry, and changes the document through commands. Families projects authored meaning through that interface. IFC handles exchange through the same neutral model. Neither adapter owns a parallel authored record store. Dependencies flow into neutral document, representation, and Placement modules, then existing brepjs geometry operations. Kernel algorithms remain behind the existing kernel abstraction.

Geometry operations dispatch exhaustively by representation. The initial variants are `BODY`, `GENERATED_FLIGHTS`, `CURTAIN_WALL_COMPOSITE`, and `NONE` with a reason. Names may change during implementation. Stored, generated, and composite geometry share validation, realization, transforms, bounds, material measurement, and cleanup. Missing support cannot return successful empty geometry. `NONE` means intentional absence, not failed reconstruction or zero measured material.

The document distinguishes spatial containment, placement parents, assembly decomposition, BIM type membership, and external classification associations. These relationships do not imply one another. Physical assemblies have no synthetic Body. Aggregation and ordered nesting are explicit relationships. Building, Bridge, Road, and Railway enter the facility abstraction with explicit support states; Bridge is the first complete authoring/exchange path. Detailed nested-Site legality remains separate.

Acceptance requires that adding a class of physical element using an existing representation changes no shared geometry ownership, disposal, Placement, or aggregate measurement. Verify this with IfcSign and direct IfcMember extensions and inspect their diffs.

Legitimate class-specific changes include semantic and payload validation, legal combinations, convenience authoring commands, geometry recipes, opening/filling restrictions, IFC class/schema/type/role mappings, applicable quantities/property sets, standards projections, documentation, and focused tests.

After those probes pass, publish focused document, authoring, IFC, Families, and standards entrypoints. Model imports must not transitively load IFC or Families. Exact names and peer dependencies await packed-consumer evidence.

## Consequences

### Positive

- New classifications reuse complete geometry behavior.
- Contributors can locate record ownership, authoring rules, and exchange policy independently.
- Breaking changes allow one coherent contract during the prototype.

### Negative / Trade-offs

- Model consumers and Families require a coordinated migration.
- A new representation still needs shared operations and tests.
- Explicit support states expose missing capabilities that conventions previously obscured.

## Alternatives Considered

### Extend existing class lists or register lifecycle callbacks

Both keep generic geometry behavior dependent on Classification and fail the extension criterion.

### Flatten every representation into a stored Body

This simplifies dispatch but removes generated/composite intent and changes when expensive geometry is realized.

### Split packages or preserve a permanent facade

Both conflict with the accepted package and prototype constraints and add competing contracts.

## Related

- [ADR-0002: Authored Body authority](0002-authored-body-authority.md)
- [ADR-0003: Geometry ownership and material operations](0003-geometry-ownership-and-material-operations.md)
- [ADR-0004: Document-resolved Placement and Datum](0004-document-resolved-placement-and-datum.md)
- [ADR-0005: Families projection into BIM](0005-families-projection-into-bim.md)
- [ADR-0006: IFC exchange adapter](0006-ifc-exchange-adapter.md)
- [ADR-0007: IFC import fidelity and item outcomes](0007-ifc-import-fidelity-and-item-outcomes.md)
- [ADR-0008: Explicit BIM type identity](0008-explicit-bim-type-identity.md)
- [Evidence and original concern mapping](../architecture-evidence.md), [bounded migration and acceptance scenarios](../architecture-migration.md)
- Root decisions on [layering](../../../../docs/decisions/0001-layered-architecture.md), [kernel/domain boundaries](../../../../docs/decisions/0006-domain-boundaries.md), and [identity beside content](../../../../docs/decisions/0014-identity-beside-content.md)
