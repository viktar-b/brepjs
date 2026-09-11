# ADR-0002: Preserve authored Body authority

**Status**: Proposed
**Date**: 2026-09-10
**Authors**: Viktar, with Codex

## Context

A Family invocation may produce final geometry that a simpler BIM recipe cannot reproduce. At the [reviewed baseline](../architecture-evidence.md#evidence-baselines), authored Body adoption is restricted to Wall and Railing and follows creation of a parametric candidate. A reported shaped Roof with an opening retains typed semantics only by changing its geometry; exact adoption rejects that class.

The [BIM glossary](../../CONTEXT.md) separates authority, provenance, and item count. An authored singleton can be authoritative; a recipe can generate several disconnected solids. Parametric Family authoring does not authorize a different BIM recipe to replace its result.

The rule requiring explicit caller-requested conversion was accepted on September 10. Direct creation and the surrounding interface remain part of this Proposed record.

## Decision

Explicitly authored Body items govern material shape. Retain those items and their authority even when a recipe could produce coincident material. Conversion to recipe authority requires an explicit caller request through an authoring command. The command must preserve required shape and item semantics and record the change. Automatic substitution after a stronger coincidence check is excluded.

Authority determines which shape governs; provenance describes how geometry was obtained. Neither determines item count, IFC encoding, validity, or reconstruction fidelity. Proposed state labels `PARAMETRIC` and `AUTHORITATIVE` describe the Body's relationship to the BIM authoring recipe, not the method used to construct its solids.

Stored geometry governs current queries and export. A recipe belongs to authoring data and can produce a replacement Body through an explicit command. Descriptive dimensions do not authorize regeneration when they disagree with retained geometry.

Body replacement retains BIM type membership and external classification associations under [ADR-0008](0008-explicit-bim-type-identity.md). Geometry authority does not authorize reclassification or changes to shared semantic identity.

Any supported Classification using `BODY` can be created directly from validated authored items, physical element identity, and Placement. It does not require a valid generator specification or a disposable parametric candidate first. Optional class-specific descriptive data cannot become a geometry-generation prerequisite.

For a shaped Roof with an opening, authoring adopts the final local Body and its valid relationships together. IFC maps Roof semantics and encodes the retained items. An opening already cut into the Body is not subtracted again. Recipe-based opening commands must reject incompatible authoritative state before mutation. Missing typed support produces a capability error; Proxy requires a deliberate caller choice.

Acceptance requires direct shaped-Roof creation without a rectangular recipe, preservation of the opening, and unchanged material and identity after IFC reload. Singleton authoritative Bodies and multi-item recipe Bodies must both work. A coincident recipe must leave authored items and authority intact unless the caller requests conversion. Implementing conversion itself is not required for the initial migration.

## Consequences

### Positive

- Authored geometry survives projection without needing an approximate recipe.
- Classification can remain Roof, Sign, or Member when geometry is arbitrary.
- Authority changes are visible authoring actions.

### Negative / Trade-offs

- Some Bodies cannot support existing parametric editing commands.
- Retained geometry can cost more to encode than a compact recipe.
- Conversion needs validation of both material and item semantics if implemented.

## Alternatives Considered

### Automatically substitute a coincident recipe

This can retain convenient editing and compact encoding, but changes authored authority and potentially item semantics. The accepted explicit-conversion rule rejects it.

### Build a disposable candidate before adoption

This couples direct Body creation to recipe availability and adds allocation and failure paths unrelated to authored geometry.

### Use Proxy for every arbitrary Body

This preserves shape at the cost of requested Classification and does not solve authority.

## Related

- [ADR-0001: Independent axes](0001-independent-product-representation-and-placement.md)
- [ADR-0003: Adoption and replacement ownership](0003-geometry-ownership-and-material-operations.md)
- [ADR-0005: Families projection](0005-families-projection-into-bim.md)
- [Evidence for Body limits and the analytical overlap counterexample](../architecture-evidence.md#reconciliation-of-the-original-eight-concerns)
- Repository [#2272](https://github.com/andymai/brepjs/issues/2272), [#2286](https://github.com/andymai/brepjs/pull/2286), and [#2295](https://github.com/andymai/brepjs/pull/2295)
