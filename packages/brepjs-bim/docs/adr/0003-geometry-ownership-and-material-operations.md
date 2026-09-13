# ADR-0003: ProductBody ownership and occupied material

**Status**: Proposed
**Date**: 2026-09-13
**Authors**: Viktar, with Codex

This record describes the Body foundation implemented in this candidate. It awaits review. It does not accept the later document, representation, Placement, Families, or IFC migration steps.

## Context

`ProductBody` and the regressions introduced in [#2286](https://github.com/andymai/brepjs/pull/2286) and [#2295](https://github.com/andymai/brepjs/pull/2295) already provide ownership for Wall and Railing geometry. Their original contract makes PARAMETRIC a singleton and EXACT a nonempty collection. That couples authority to item count. Takeover also retains the caller's collection and only checks an alias to the target's current singleton.

Families currently select recipe authority when a coincidence comparison passes. This discards authored items without an explicit conversion request. Wall quantities use an occupied union, but imported Body volume sums items. Two cubes of side 100 mm offset by 50 mm occupy 1,500,000 mm³, while their item-volume sum is 2,000,000 mm³.

The [discussion](https://github.com/andymai/brepjs/discussions/2303) and [review of the migration drafts](https://github.com/viktar-b/brepjs/pull/2) support breaking changes and extending the existing owner. The implementation retains `ProductBody` until representation convergence. No compatibility facade is needed.

Native ownership requires more than JavaScript handle counts. In occt-wasm, a handle's native `delete()` does not free its arena slot. Tests must observe the raw kernel's `getShapeCount()` and dispose their own intermediates, following the existing root arena disposal tests.

## Decision

### One Body contract

`ProductBody` has either `kind: 'PARAMETRIC'` or `kind: 'AUTHORITATIVE'`. Both require `items: NonEmpty<ValidSolid>`. `EXACT`, `solid`, and `solids` are removed from this contract. Authority governs which authoring commands are permitted. Provenance describes how geometry was produced and does not follow from authority or item count. This slice adds no provenance tracking system.

Items are solid material in the Physical element's local coordinates. They may overlap or be disconnected. Their order and count survive borrowing, measurement, and export. The existing `bodySolids()` operation borrows the stored items. Borrowers must not dispose them. Retention beyond the owner requires independent copies, including for evaluator and topology-cache results.

Stored items govern current shape under both authorities. Families copy and localize authored items, then adopt them as AUTHORITATIVE. Coincidence with a recipe does not replace them or change authority. Conversion to PARAMETRIC requires an explicit caller request through `takeProductBody` with replacement items and that authority. This is an explicit replacement operation, not an automatic recipe conversion feature.

### Validation and ownership transfer

`BimModel.takeProductBody()` replaces the Body of an existing Wall or Railing. The shared Body module validates the complete collection before transfer. Every item must be a live valid solid. Empty collections, duplicate handles, invalid authority, and handles already owned anywhere in the target model are rejected. The model scans its current geometry owners rather than maintaining a second ownership registry during this migration.

The caller must exclusively own supplied handles. Runtime checks and TypeScript `readonly` cannot prove arbitrary external aliases or ownership in another document. Cross-document reuse requires independent copies. Calling the operation with borrowed evaluator/cache items violates this precondition.

Preparation copies and freezes the Body object and its item collection. It does not consume any handles. Updating the element map is the ownership commit point. Before it, an error leaves caller inputs and the prior model state unchanged. After it, the model owns every new item and releases the superseded Body through the shared disposal operation. Supported ShapeHandles swallow native disposal and dependent-callback exceptions, so cleanup does not change the successful transfer result. Repeated model disposal does not revisit released owners. This contract does not cover callers overriding handle disposal methods.

Replacement changes only geometry. It preserves identity, Classification, descriptive metadata, Placement, style, containment, and existing relationships. Already-cut openings remain cut. The operation does not subtract them again. Opening authoring rejects AUTHORITATIVE walls. For PARAMETRIC collections, an opening command prepares every cut item before replacement and releases new outputs if a later item fails or throws. An opening may fully consume an individual item; the resulting Body must still contain material. Removing all items rejects the command without changing the model. Empty generated topology is distinct from invalid non-solid output, which is rejected and released.

### Occupied material measurement

`measureProductBodyVolume()` borrows the Body and returns a `Result` in mm³. A singleton is measured directly. Multiple items use a temporary occupied union. Each intermediate and final union is disposed on success, returned failure, or throw. Retained items are never replaced by the union.

An unavailable, non-finite, or invalid material measurement returns an error. Zero and bounding-box estimates are not substitutes. This shared operation serves Body quantities and complete imported Body aggregates. Partial reconstruction retains its existing incomplete result and does not gain a whole-Body quantity.

Wall and Railing export serializes every stored item through tessellation under both authorities, including PARAMETRIC, instead of regenerating recipe extrusions. Descriptive recipe dimensions do not authorize replacing that shape. Wall NetVolume uses occupied material. NetWeight uses that volume with a resolved density for a bare material or a single material layer. Name-based densities remain nominal material estimates. Multiple layers do not establish an element-wide density, so their weight is omitted. Nominal dimensions and the Wall Axis remain descriptive references. Recipe-derived gross volume, footprint area, side area, and GrossWeight are omitted because arbitrary retained items do not establish those quantities. Optional unavailable quantities remain omitted under the existing adapter policy.

### Boundary of this slice

Wall and Railing remain the existing Body-enabled classifications. Civil Families projection still creates a recipe candidate before authored Body adoption. Direct authored creation without that candidate remains a later step, including the shaped typed Roof case. Other stored-solid classes still have their current representation and disposal paths. Full representation convergence will rename `ProductBody` to `Body` and work toward `BODY | NONE`. This foundation does not establish the complete class-extension criterion.

Stair and Ramp export retains a geometryless assembly plus separate flight entities with Bodies and placements. Curtain-wall children retain their existing assembly semantics. No `GENERATED_FLIGHTS` or `CURTAIN_WALL_COMPOSITE` variants are introduced.

Full `BimDocument` replacement, direct typed Roof creation, universal Placement commands, Families semantic cutover, new IFC classes, type identity, and schema expansion remain later work. The Sign/Member extension probe belongs after representation convergence. ADR numbers 0005 through 0008 remain reserved for that deferred work and are not included here.

### Executable acceptance

- [Public model acceptance](../../tests/productBodyFoundation.test.ts) covers protected mutable inputs, target-model aliases, later invalid items, preserved openings and metadata, and multi-item PARAMETRIC round trips with occupied volume and retained item order.
- [Native lifecycle acceptance](../../tests/productBodyArenaDisposal.test.ts) uses the occt-wasm arena count alongside disposal evidence.
- Existing [takeover and placement regressions](../../tests/exactProductBodyTakeover.test.ts), [Families regressions](../../tests/familiesProductBody.test.ts), and [quantity/export failure tests](../../tests/exactProductBodyIfc.test.ts) migrate to the new contract.

These tests prove the exercised geometry and ownership paths. They do not qualify every IFC schema, receiving application, or native backend, and they make no performance claim.

## Consequences

### Positive

- Authority no longer restricts Body item count.
- Adoption and replacement have a single transfer boundary and protected stored collections.
- Authored geometry survives projection and export without implicit recipe substitution.
- Overlapping items have the same material-volume definition in shared consumers.

### Negative / Trade-offs

- Callers must migrate the breaking Body shape and takeover method.
- PARAMETRIC Wall and Railing export now uses retained-item tessellation instead of compact recipe extrusions.
- Temporary unions add Boolean work and may fail; their performance is unmeasured.
- External ownership remains a caller obligation, and other representations still need convergence.

## Alternatives Considered

### Add a parallel Body owner or compatibility variants

This would duplicate lifecycle rules and leave existing authoring paths on the old contract. The foundation extends `ProductBody` and migrates its callers in one change.

### Keep a separate ownership ledger

All unrelated adders and removal paths would need to keep it synchronized. Scanning existing model geometry is sufficient for this bounded replacement boundary. Representation convergence can remove the remaining class-specific traversal.

### Automatically retain a coincident recipe

This changes authored authority and can discard item identity even when material coincides. Only an explicit caller-requested replacement can change authority.

### Fuse stored items permanently or sum their volumes

Permanent fusion loses authored item identity. Summation double-counts overlap. A temporary occupied union preserves both the items and the material quantity.

## Related

- [BIM domain vocabulary](../../CONTEXT.md)
- [ProductBody implementation](../../src/types/productBody.ts)
- [Model authoring and replacement](../../src/model/bimModel.ts)
- [Native arena regression pattern](../../../../tests/wasmArenaDisposal.test.ts)
