# ADR-0004: Document-resolved Placement and explicit Datum

**Status**: Proposed
**Date**: 2026-09-10
**Authors**: Viktar, with Codex

## Context

The [reviewed source](../architecture-evidence.md#reconciliation-of-the-original-eight-concerns) still requires an optional caller-supplied `parentFrame` for World geometry, dispatches Placement by class, and recovers Datum through `Translate`/`Rotate` wrappers with zero defaults. Earlier fixes for #2259 and #2270 remain resolved; these broader limitations survive them.

The accepted direction separates Placement from Classification and Geometry representation, resolves rigid frames first, retains unsupported reference intent, and consumes rotation pivots in authored order. This record preserves those decisions and proposes the complete document/query contract using the [BIM glossary](../../CONTEXT.md).

## Decision

Every placeable physical element, spatial container, and assembly has a Placement definition. The document validates parents and references and resolves the complete chain into World coordinates. Placement parents, containment, and decomposition obey separate relationship rules. Assembly decomposition alone never rebases a child's Placement.

Neutral relationship validation follows [ADR-0001](0001-independent-product-representation-and-placement.md); IFC-specific relationship legality follows [ADR-0006](0006-ifc-exchange-adapter.md). Exchange acceptance must preserve these separate relationships as well as their resulting World frames.

`LOCAL_FRAME` is a finite, right-handed rigid pose. Reject degenerate or nonorthogonal axes, scale, shear, reflection, and non-finite values before geometry operations. Missing parents, cycles, invalid frames, and unsupported reference resolution return typed errors.

`GRID_REFERENCE` and `LINEAR_REFERENCE` retain authored references and parameters. Initially only `LOCAL_FRAME` must resolve fully. Unsupported reference operations preserve intent and fail explicitly. A resolved frame is a result, not a replacement for reference-based intent; full grid and linear solvers are separate work.

For rigid geometry, `WorldBody = WorldParentFrame × PlacementFrame × LocalBody`, applying the right-hand operand first. Ancestor frames compose in order, and transform lists preserve authored order and consume pivots during the fold.

`LocalBody` already includes its Datum convention, generator centring, intrinsic rotations, and item offsets in the physical element's local frame. Datum is independent of the recipe; it is not another executable Body placement. Do not infer an extra transform from descriptive `datum` metadata or introduce a separate `bodyDatumOrigin`.

Document queries explicitly request the physical element's local coordinates, a named container's local coordinates, or World coordinates. World queries resolve their own parent chain and take no arbitrary optional `parentFrame`. Low-level representation operations may accept a validated resolved frame without claiming document identity.

The public frame query accepts any placeable record's identity and an explicit target space: World, the record's own local frame, or another named placeable record's local frame. It returns an independent, validated rigid transform from the queried record's local coordinates into that target space, tagged with both frame identities. Source and target records must belong to the queried document. For a named target, the transform is `inverse(WorldTargetFrame) × WorldSourceFrame`; the own-local result is identity after validation. Missing records, invalid chains, and unsupported resolution return the same typed errors for every record kind, including own-local queries.

Frame queries do not require, realize, or allocate geometry. Physical elements with any representation, spatial containers, and assemblies with `NONE` use the same public operation. Geometry queries consume this frame-resolution contract. Returned frames are snapshots of the committed document state at query time, not mutable references to internal state.

Public Placement changes use the same commands for all placeable record kinds. Setting a `LOCAL_FRAME` replaces its pose relative to the existing placement parent. Placement descendants retain their own definitions and follow the changed ancestor when next resolved. Containment and decomposition alone do not move other records. Placement changes leave Body-local geometry, Datum, identity, metadata, and unrelated relationships unchanged.

Reparenting requires an explicit `KEEP_LOCAL` or `KEEP_WORLD` policy, with no default. `KEEP_LOCAL` retains the record's local pose under the new placement parent. `KEEP_WORLD` resolves the record's old World frame and the new parent's World frame, then sets `NewLocalFrame = inverse(NewParentWorldFrame) × OldWorldFrame`. The parent edge and any changed local pose commit together. Descendants retain their definitions; resolvable `LOCAL_FRAME` descendants follow under `KEEP_LOCAL` and retain their World poses under `KEEP_WORLD`. Reparenting changes neither containment nor decomposition. Both policies validate the proposed graph; `KEEP_WORLD` also requires both World frames to resolve. Initially move and reparent commands support `LOCAL_FRAME` placements only. Unsupported reference-based operations return typed capability errors without flattening or discarding authored intent.

Deleting a record fails with a typed error identifying its dependants while it remains a placement parent, an authored Placement reference target, a containing container, or a decomposition parent. Callers must explicitly reparent dependants or remove the relevant relationships through valid document commands before deletion. Deletion never silently cascades, detaches, or reparents children. Successful deletion removes the record and its remaining relationship edges and releases only its owned geometry under [ADR-0003](0003-geometry-ownership-and-material-operations.md).

Placement changes and deletion validate the proposed state before committing. Missing parents, cycles, invalid frames, illegal relationships, and unsupported operations leave the previous graph, Placement definitions, and retained geometry unchanged. Subsequent queries see the complete committed change, including affected descendants, with no stale resolved frames. Previously returned frame snapshots remain unchanged.

Families resolution exposes Placement and tagged local geometry independently. Tagged World geometry can be cloned and inverse-localized once. Reject untagged input. Remove wrapper inference and zero recovery. A temporary migration shim must fail on unexpected structures, preserve #2270 regressions, and disappear at the Families cutover.

IFC tessellates in the physical element's local frame, encodes Placement separately, and converts units once. Local coordinates reduce avoidable precision loss but do not guarantee planar or closed meshes.

Acceptance compares authored, queried, and imported World geometry for nested rotated containers and a pitched physical element with an internal Datum. Cover both transform orders, non-origin pivots, missing parents, and cycles. Thin sloping panels far from the origin require reloaded shape checks, not a universal snapping rule.

Public-interface acceptance also resolves frames for a physical element, a spatial container, and a bodyless assembly in own-local, named-target-local, and World spaces without geometry realization. Exercise moves, both reparent policies, descendant queries, referenced-parent deletion, and failed changes under translated and rotated parents. Check unchanged local Bodies, unchanged prior frame snapshots, current query results after commits, and unchanged document state after rejection. The [migration scenarios](../architecture-migration.md#acceptance-scenarios) specify the observable outcomes.

## Consequences

### Positive

- World queries cannot silently return container-local geometry.
- Placement works across classifications and representation variants.
- Bodyless records expose the same frame queries and Placement changes as geometry-bearing records.
- Geometry construction can change without changing Datum recovery.

### Negative / Trade-offs

- Existing callers must supply explicit coordinate-space information.
- Reparenting requires an explicit preservation policy, and parent deletion requires callers to handle dependants first.
- Reference-based Placement remains unsupported for some operations initially.
- Local tessellation still needs native and exchange precision qualification.

## Alternatives Considered

### Require callers to compose parent frames

This duplicates model knowledge and permits silent local/World confusion.

### Infer Datum from geometry wrappers

Equivalent geometry can use different wrapper structures, making Placement depend on construction details.

### Flatten arbitrary geometry into World-space proxies

This discards explicit local frames and exposes thin geometry to avoidable coordinate-magnitude error.

## Related

- [ADR-0001: Neutral document](0001-independent-product-representation-and-placement.md)
- [ADR-0005: Families projection](0005-families-projection-into-bim.md)
- [ADR-0006: IFC coordinate and unit encoding](0006-ifc-exchange-adapter.md)
- Repository [#2259](https://github.com/andymai/brepjs/issues/2259), [#2270](https://github.com/andymai/brepjs/issues/2270), and [#2273](https://github.com/andymai/brepjs/pull/2273)
- [Placement and precision acceptance scenarios](../architecture-migration.md#acceptance-scenarios)
