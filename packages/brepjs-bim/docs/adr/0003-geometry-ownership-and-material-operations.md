# ADR-0003: Shared geometry ownership and material operations

**Status**: Proposed
**Date**: 2026-09-10
**Authors**: Viktar, with Codex

## Context

At the [reviewed baseline](../architecture-evidence.md#evidence-baselines), geometry lifetime is repeated across classes. Body adoption checks some aliases but retains caller-owned containers and does not check every handle already owned by the target document. These are enforcement limits, not a reproduced failure under the exclusive-ownership precondition.

Material measurement also differs by consumer. Exact Wall quantities use occupied union while Families comparison and import sum item volumes. The [analytical overlap counterexample](../architecture-evidence.md#overlapping-item-coincidence-analytical-counterexample) shows why those quantities are not interchangeable. It remains untested in the native kernel.

## Decision

The Body module implements one cohesive interface for validation, adoption, borrowing, copying, transforms, disposal, bounds, and material measurement. The document owns adopted Bodies and tracks document-wide handle ownership. These operations do not inspect Classification or own Placement storage, recipe parsing, IFC entities, or document traversal.

The contract is:

1. A retained item has one owner and one disposal path. Evaluator results, topology-cache handles, and read indexes are borrowed. Borrowers must not dispose these handles. Retention beyond an owner's lifetime requires an independent copy.
2. Adoption validates the entire nonempty collection before transfer. Items must be live valid solids with distinct handle identities and a compatible representation. No item may already belong to another record in the target document. Exclusive caller ownership is required; `readonly` cannot prove external aliasing or cross-document ownership. Cross-document reuse requires independent copies or an explicit transfer protocol.
3. Successful adoption copies and protects the collection while transferring handles. Failure leaves caller handles live and the document unchanged. One explicit commit point determines ownership; later cleanup faults must not make it ambiguous.
4. Replacement preserves physical element identity, metadata, type reference, external classification associations, appearance, Placement, and valid relationships under [ADR-0008](0008-explicit-bim-type-identity.md). Already-cut authoritative geometry is not cut again because a void relationship exists.
5. Transform and realization operations borrow inputs and return fresh owned outputs. A later-item error or throw releases every new output and intermediate without disposing retained inputs. Document disposal is idempotent; tests count releases to detect duplicate owners hidden by idempotent handles.
6. Bounds include every item in a named coordinate space. Body material volume is occupied union, including disconnected or overlapping items. An explicitly named item-volume sum may be diagnostic only. Overlap between separate physical elements is a different quantity policy.
7. Measurement may create a temporary union and must release it on every exit. It never merges retained or exported items. Rigid Placement does not change volume. Failure returns unavailable/error, never zero or an envelope estimate.

The same measurement implementation serves authoring comparisons, document queries, complete imported Bodies, and quantity adapters. Optional IFC quantities may be omitted with a diagnostic; required measurements fail the operation. Nominal dimensions remain class-specific facts. Gross volume, surface quantities, and weight need supporting facts, not an authoritative Body's bounding box.

Generated representations own temporary realized items for the operation. Composite representations apply component-local offsets before the physical element's Placement. Both use the same all-item operations and cleanup rules. Intentional absence is distinct from zero measured material.

Acceptance requires later-item failures and throws during adoption, transforms, realization, and union measurement. Check duplicate and disposed handles, target-document aliases, caller-mutable arrays, unchanged inputs, and exact release counts. Disconnected and overlapping Bodies preserve order and item count through measurement and exchange.

## Consequences

### Positive

- Ownership and failure rules have one implementation per representation.
- All consumers agree on material volume.
- New classifications inherit complete lifecycle behavior.

### Negative / Trade-offs

- Copies, realization, and temporary unions have costs that require measurement.
- Runtime validation cannot prove arbitrary external ownership.
- Cleanup failures require a clear post-commit outcome rather than ambiguous rollback.

## Alternatives Considered

### Lifecycle callbacks per class

They repeat shared policy and allow new classifications to omit required behavior.

### Fuse retained items permanently

This loses authored item identity and performs Boolean work even for traversal.

### Sum volumes or use bounds after a failed union

Both can report plausible but incorrect material quantities. An explicit unavailable result preserves the failure.

## Related

- [BIM glossary](../../CONTEXT.md)
- [ADR-0001: Representation dispatch](0001-independent-product-representation-and-placement.md)
- [ADR-0002: Body authority](0002-authored-body-authority.md)
- [ADR-0007: Complete and partial imported Bodies](0007-ifc-import-fidelity-and-item-outcomes.md)
- [Evidence and source references](../architecture-evidence.md), [failure and overlap acceptance scenarios](../architecture-migration.md#acceptance-scenarios)
