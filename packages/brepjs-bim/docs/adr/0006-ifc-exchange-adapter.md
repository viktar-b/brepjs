# ADR-0006: Keep IFC exchange behind an adapter

**Status**: Proposed
**Date**: 2026-09-10
**Authors**: Viktar, with Codex

## Context

The [reviewed source](../architecture-evidence.md#reconciliation-of-the-original-eight-concerns) mixes semantic class loops, representation encoding, and selective style application. Error-level runtime diagnostics and foreign-object declaration mismatches have also been reported by third-party projects.

Cleanup already exists. `toIfc` scopes its writer with `using`, and `save` closes its model in `finally`. An unconditional pre-save leak claim is outdated; neither diagnostics nor declaration mismatches establish measured heap growth.

The neutral document needs an exchange adapter that owns IFC-specific policy without replacing authored geometry or defining neutral Placement types.

## Decision

The IFC adapter owns schema entities and capabilities, class/type/role mappings, standard property sets, source IDs, file metadata, representation and Placement encoding/decoding, unit conversion, graph scheduling, runtime validation, diagnostics, and foreign resources.

Declare support by exact schema release and exchange profile, including legal entity, type, predefined-value, relationship, property-set, and representation combinations. Record reader recognition, implemented import, implemented export, and independent qualification separately. An entity mapping or accepted schema alias alone establishes none of the other states. This is a bounded exchange contract, not a full IFC-schema mirror.

Semantic handlers validate requested Classification and legal schema combinations. They select entity and predefined intent, including required user-defined labels. Physical element metadata and assigned BIM type values follow the selected schema's rules; do not blindly stamp both. Role tables require focused review. Unsupported capabilities fail explicitly, and a schema alias cannot claim support the runtime lacks.

The adapter encodes the type definitions, property scopes, and external classification associations owned under [ADR-0008](0008-explicit-bim-type-identity.md). Preserve every requested supported association, supplied classification identity and edition, and supplied parent-reference chain. Property data types and physical values survive documented unit conversion. Missing optional source fields stay absent; delivery requirements may require them explicitly. Schema mapping cannot merge distinct definitions or invent classification values.

Representation encoding operates independently of Classification. It borrows retained geometry and preflights every item into plain serializable data before committing its owning representation. One retained Body item becomes one IFC Body representation item. Measurement unions are temporary and are never exported. Unsupported typed intent cannot silently become Proxy.

Schedule contexts, containers, physical elements, relationships, types, appearances, and quantities in dependency order. Encoding returns every styleable target, including generated and composite geometry. The common writer applies the physical element's optional appearance to all of them and creates no synthetic style for unstyled elements.

Neutral lengths use millimetres, areas mm², and volumes mm³. Convert geometry, Placement, and quantities exactly once at the IFC boundary. Tessellate in the physical element's local frame and encode its Placement separately. Geographic CRS/map conversion is distinct from the document's World frame. Configurable output units remain separate work.

Export returns no partial artifact as success. A later item or graph failure releases adapter temporaries and owned runtime resources while document geometry stays live. Validate raw backend values at the interface. Cover initialized APIs, vectors, geometry handles, initialization failures, and existing writer/model scopes. Foreign cleanup rules remain backend-specific.

Successful export requires all mandatory runtime checks to pass and all requested supported content to be emitted. Error-level validation or backend diagnostics prevent success; returning bytes alongside an error report is not successful export. Capture lookup/write failures as actionable typed errors; do not globally suppress them. Optional unavailable measurements may omit a quantity with a diagnostic; required measurements fail.

Independent qualification is separate from runtime success. CI must qualify freshly generated files for the claimed schema/profile using independent STEP syntax, EXPRESS, and applicable normative-rule checks. Record industry-practice findings, project IDS requirements, semantic preservation, geometric fidelity, and receiving-application results separately. Required failed, unavailable, or unrun checks block the corresponding qualification claim. This policy does not require a remote service or Python runtime in every export call. [Validation procedures and receipts](../../VALIDATION.md#proposed-exchange-qualification) hold the operational details.

Preservation acceptance follows authored document → IFC → imported-document read contract for the declared supported subset. Compare physical element and type identities, memberships, Classification, external classification associations, shared and occurrence properties, materials, relationship endpoints, Placement, appearance, and every Body item. Effective values and entity counts alone cannot establish preservation. Arbitrary IFC → authored document → IFC exchange and native Family recovery remain outside scope until their separate contracts exist.

Acceptance also requires failed later-item writes that return no successful artifact. Verify resource release and live document inputs on returned errors and throws. Thin sloping panels with holes must retain qualified geometry after reload. Test explicit facility/schema support states and diagnostic-free success, with the semantic and negative cases in the [migration note](../architecture-migration.md#ifc-semantic-preservation-and-qualification).

## Consequences

### Positive

- Schema support can grow without changing shared geometry lifecycle.
- Export preserves authored items and keeps document ownership intact.
- Runtime failures have a defined result and cleanup owner.

### Negative / Trade-offs

- Preflight requires temporary memory and delays representation commit.
- Backend-specific cleanup and diagnostic behavior need native qualification.
- New semantic classes still require schema mappings and focused exchange tests.
- Independent qualification needs pinned tools, fresh fixtures, and explicit results for each claimed exchange profile.

## Alternatives Considered

### Keep IFC types and runtime behavior in the document

This makes neutral model operations load exchange dependencies and ties Placement to a writer.

### Let semantic handlers own geometry lifecycle and style application

This repeats all-item behavior per class and permits omissions such as unstyled generated geometry.

### Return valid bytes despite failed items or backend errors

This conceals incomplete exchange as success and prevents callers from assessing the result.

## Related

- [BIM glossary](../../CONTEXT.md)
- [ADR-0001: Dependency direction](0001-independent-product-representation-and-placement.md)
- [ADR-0003: Borrowing and material measurement](0003-geometry-ownership-and-material-operations.md), [ADR-0004: Coordinates](0004-document-resolved-placement-and-datum.md)
- [ADR-0007: Import outcomes](0007-ifc-import-fidelity-and-item-outcomes.md), [ADR-0008: Metadata, type identity, and appearance](0008-explicit-bim-type-identity.md)
- [Runtime evidence](../architecture-evidence.md), [exchange acceptance scenarios](../architecture-migration.md#acceptance-scenarios)
- [buildingSMART validation layers](https://technical.buildingsmart.org/services/validation-service/), [IDS information requirements](https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/)
