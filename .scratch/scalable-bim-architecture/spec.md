# Scalable BIM architecture

Status: ready-for-agent

## Problem Statement

Adding one typed IFC Product currently requires coordinated edits across category types, geometry storage, model disposal, placement, validation, quantities, IFC import and export, Families projection, and public exports. The same semantic category often decides both what a Product means and how its geometry is stored. That coupling makes support for `IfcMember`, `IfcSign`, and additional facility types expensive and easy to implement incompletely.

Issue #2272 exposes the immediate failure. A typed wall or railing can have an evaluated Family Body that differs from its parametric envelope. The Body may contain multiple disconnected solids or direct boolean cuts. Replacing it with one generated solid changes the authored volume and bounds. The current implementation also lacks one owner for multi-item Body traversal, placement, validation, quantities, serialization, import, and cleanup.

The package has a second boundary problem. The mutable model owns records, relationships, geometry generation, placement policy, lifetime management, and category-specific authoring methods. IFC code owns types used by the model. The Families adapter reconstructs Product meaning from free-form strings and property bags. IFC export repeats category loops, and IFC import has a separate closed category table. A new category can compile while a missed placement branch silently returns no geometry.

A correct Body at the wrong World location is still a false Product. Civil models fail this way when nested Site, Facility, and Facility Part rotations drop a Body-local Datum, or when a typed route rebuilds a centred envelope from semantic dimensions. Classification and representation cannot repair that. Placement is a third independent axis, not a writer helper.

The same fragmentation affects occurrence metadata, reusable Product type grouping, surface-style application, and declarative assembly projection. These policies belong to neutral document records or adapter-wide traversal, not to individual Product writers.

The package itself remains the correct product boundary. Moving it to another Git repository would preserve these internal problems while adding cross-repository version coordination. The rework must therefore deepen the internal modules, prove that new IFC classes have bounded implementation cost, and only then publish smaller package entrypoints.

## Settled decisions

1. `brepjs-bim` stays in the brepjs monorepo.
2. The rework keeps one `brepjs-bim` npm package.
3. Breaking changes are allowed. The implementation must not preserve the old API through a compatibility facade.
4. Issue #2272 is part of this architecture rework. The Product Body implementation ticket closes it.
5. The existing `fix/typed-civil-bodies` branch is implementation research and regression-test prior art. It is not the architecture to merge or mechanically reproduce.
6. The Product Body ticket preserves authoritative exact Bodies, multiple IFC Body items, Product-local ownership, fresh World-placed outputs, atomic cleanup, reliable quantities, and IFC round trips.
7. Product classification, geometry representation, and placement are independent axes. Classification never selects a placement policy.
8. Product Body owns Body items and their lifetime policy.
9. Body cardinality is independent from parametric or authoritative provenance.
10. Every placeable element, spatial node, or assembly owns a `PlacementDefinition`. Product Body and geometry representations store no occurrence placement.
11. `PlacementDefinition` is a closed union. `LOCAL_FRAME` is the first fully resolved variant. `GRID_REFERENCE` and `LINEAR_REFERENCE` preserve target-independent parametric intent for Building and linear facilities from the first facility abstraction and return typed unsupported results wherever resolution or projection is not implemented.
12. A validated `ResolvedFrame` is the only rigid pose consumed by geometry placement operations. It is a resolved result, not the stored form of every possible placement definition.
13. Body-local Datum translation, generator centring, and Body-item offsets remain Product-local geometry. They never move into occurrence placement. Temporary CSG-wrapper recovery is migration code and is deleted at the typed Families cutover.
14. Families occurrence `tRotate` and `tTranslate` lists fold in authored order into `LOCAL_FRAME` placement. Occurrence rotation is not baked into stored Product-local CSG.
15. `BimDocument` owns spatial-parent traversal and resolves a record's placement to World coordinates. High-level World queries do not accept an arbitrary optional parent frame.
16. World-bound equality uses the document-resolved World frame. Container-local bounds are not World bounds.
17. IFC and Families are sibling adapters around a neutral BIM document.
18. Bridge is the first complete implementation priority.
19. Building, Bridge, Road, and Railway enter together when the first facility abstraction is introduced.
20. `brepjs-families` changes only during the typed built-asset semantics cutover.
21. `brepjs-families` remains independent from `brepjs-bim`, Product Body, `web-ifc`, and IFC enums.
22. `IfcMember` and `IfcSign` are architecture probes, not early special cases.
23. Curated package entrypoints ship only after both probes pass.
24. Moving BIM to another Git repository is out of scope.

## Issue integration scope

| Treatment                                  | Issues                                                                                                            | Effect on this spec                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required architecture outcomes             | BREP-005 (#2272), BREP-004, BREP-007, BREP-008, BREP-011, and the structural all-item import behavior of BREP-013 | Product Body, occurrence metadata, reusable Product types, all-item styling, declarative Physical Assembly, and class-independent IFC representation decoding must ship through the existing migration tickets.                                                                                               |
| Completion gates and preserved regressions | BREP-001, BREP-014 (#2270), and BREP-006                                                                          | Preserve composed placement, rotated internal Body Datum, and diagnostic-free successful IFC export as gates without creating new architecture workstreams.                                                                                                                                                   |
| Architecture probes                        | BREP-002 and BREP-003                                                                                             | Member and Sign prove that the completed seams scale; old API-specific acceptance details do not constrain the replacement API.                                                                                                                                                                               |
| Separate or deferred work                  | BREP-012, BREP-009, BREP-010, and the backend-specific `flatMesh.delete` defect exposed by the BREP-013 prototype | Beam profile coordinates, the `IFC4X3_ADD2` token, configurable IFC output units, and foreign mesh cleanup do not expand the neutral domain redesign. A focused adapter fix is still required if foreign mesh cleanup blocks the mandatory BREP-013 behavior.                                                 |
| Downstream adoption                        | LOCAL-003, LOCAL-005, LOCAL-006, and LOCAL-008                                                                    | These infra-bridge changes consume occurrence metadata, Member/Sign, authoritative Bodies, and styles after the corresponding upstream seams land. Their donor-specific assertions and project edits remain downstream.                                                                                       |
| Infra-only or already closed               | LOCAL-007, LOCAL-009, LOCAL-001, LOCAL-002, LOCAL-004, LOCAL-010, and LOCAL-011                                   | Optional donor scene objects, the infra repository's reusable Family package entry, CRS, project assets, topology documentation, and completed work do not become `brepjs-bim` tickets. BREP-011 still requires one reduced neutral assembly proof without absorbing LOCAL-007's scene and set-out decisions. |

## Domain terminology

### Typed Product

A physical built-asset occurrence with a typed Product classification. Classification determines what the occurrence means and how an exchange adapter maps it. It does not determine geometry ownership, Body cardinality, or placement behavior.

### Product classification

The target-independent class of a physical occurrence, such as Wall, Railing, Member, or Sign, plus a class-specific role or predefined-type intent. External classification references remain separate metadata.

A class-specific role does not identify a reusable Product definition. An `OTHER` or user-defined role carries its required routing label in the typed role payload; generic `objectType` metadata never selects Product class or role.

### Document record identity

The document-local identity used by records and references inside one `BimDocument`. It is distinct from the stable occurrence key used for deterministic exchange identity.

### Occurrence key

A stable, target-independent key for one physical occurrence. It may contribute to deterministic adapter identifiers. It is never derived from a display name, tag, Body, placement, Product role, or reusable type definition.

### Occurrence metadata

Optional target-independent presentation values authored for one occurrence: `name`, `description`, `objectType`, and `tag`. Metadata is separate from document record identity, occurrence key, Product classification, and reusable Product type identity. Empty or whitespace-only values are invalid; an adapter may generate fallback presentation values only when an authored value is absent. Generated values affect presentation only.

### Product type definition

A reusable, target-independent document record shared by compatible Product occurrences. `ProductTypeDefinition` has its own document-local record identity, a required stable opaque `definitionKey`, Product classification, class-specific role, and reusable type payload. A Product has zero or one `typeDefinitionRef`.

`definitionKey` is independent from occurrence keys and metadata. Names, tags, placement, geometry, provenance, appearance, and Body shape never participate in type identity. Reusing a definition key with an incompatible classification, role, or type payload is invalid, and a referenced definition cannot be removed.

Families semantics supplies an explicit stable `definitionKey` or resolved `definitionKey(props)` value. The BIM adapter must not infer it from process-local component identity, Family display name, archetype, occurrence path, or occurrence key. Low-level authoring may create a Product without a reusable definition reference.

### Surface appearance

A validated neutral document record containing an optional name, RGB channels in the inclusive range `0..1`, and transparency in the inclusive range `0..1`. A Product has at most one Product-level appearance assignment in this rework. Appearance belongs to the occurrence, not its Product Body, classification, provenance, or IFC representation.

### Product Body

A non-empty collection of Product-local Body items owned by one model representation. Product Body owns item traversal, validation, transfer, disposal, aggregate measurement, and transactional transformation policy. It contains no element placement and no IFC data.

Product Body does not own occurrence metadata, reusable type identity, appearance assignment, classification, or placement. Its Body-item traversal is one input to representation encoding, not the general style-assignment mechanism.

### Body item

One independently retained solid in a Product Body. Multiple items do not imply authoritative provenance, and one item does not imply parametric provenance.

### Parametric Body

A Product Body whose material was generated from an authoring specification or recipe. The Body may have one or many items. The recipe belongs to authoring data, not to Product Body lifetime state.

### Authoritative exact Body

A Product Body whose evaluated geometry is the authority for material shape. It may contain one or many items. It can retain direct boolean results, disconnected components, and other geometry that a parametric envelope cannot reproduce faithfully.

### Product-local Body

A stored Product Body expressed in the Product coordinate frame. Internal offsets among Body items, Body-local Datum translation, and generator centring remain geometry. The element and spatial graph provide the transform into World coordinates. Replacing a representation never changes the occurrence placement definition.

### World-placed Body

Fresh caller-owned solids after the element placement and cumulative spatial placement have been applied exactly once. IFC-imported geometry also uses World coordinates unless a later, explicit normalization operation converts it into an authored document.

### Geometry representation

The exhaustive internal description of how an occurrence obtains geometry. Stored Product Body, generated flight geometry, composite curtain-wall geometry, and intentional absence of geometry are separate representation variants.

### Resolved Frame

An opaque, validated, rigid right-handed millimetre pose with `origin` and orthonormal `axisX` and `axisZ`. Boundary parsing rejects non-finite values, zero-length axes, parallel axes, non-orthogonal axes, scale, shear, and reflection. Construction, composition, and inversion preserve those invariants. Geometry operations accept only `ResolvedFrame`, never unchecked tuples or matrices.

### Placement definition

The target-independent authored intent that places an element, spatial node, or assembly relative to its parent. The closed union starts with:

| Variant            | Meaning                                                                                               | Initial support                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `LOCAL_FRAME`      | A validated rigid pose relative to the spatial parent                                                 | Fully resolved by the neutral placement module and mapped by IFC and Families adapters                      |
| `GRID_REFERENCE`   | A grid reference, two intersecting axis references, two or three signed offsets, and direction intent | Preserved by the neutral document; resolution and projection require a supported grid positioning reference |
| `LINEAR_REFERENCE` | An alignment reference plus distance-along, lateral, vertical, longitudinal, and orientation intent   | Preserved by the neutral document; unimplemented resolvers and adapters return a typed unsupported result   |

Reference-based variants point to stable, typed neutral positioning-reference records rather than IFC express IDs or Families implementation objects. A positioning reference may preserve source identity and parameters before its geometry is resolvable. A pose query against such a record returns typed unsupported; it never substitutes identity placement.

Adding a placement variant fails compilation until resolution, validation, document queries, IFC mapping, Families mapping, and focused tests handle it. Adapters must not flatten `GRID_REFERENCE` or `LINEAR_REFERENCE` into a rigid Frame and discard source parameters.

### Parametric placement

A placement definition that retains references and authored parameters so the document can resolve it again after a referenced object changes. `GRID_REFERENCE` and `LINEAR_REFERENCE` are the first declared parametric variants. `LOCAL_FRAME` is first-class rigid placement, not a parametric constraint system.

### Positioning reference

A stable, typed neutral document record referenced by a parametric placement definition. A grid reference identifies its axes and intersections. A linear reference identifies an alignment or other linear positioning source. The record may initially preserve validated source identity and parameters without carrying enough geometry to resolve a rigid pose; resolution-dependent operations then return typed unsupported. It contains no IFC express ID, IFC enum, or Families runtime object in the authored document contract.

### Product placement

The occurrence `PlacementDefinition` relative to its spatial container. The placement resolver combines it with the ordered spatial ancestor definitions and any referenced positioning record, then returns one `ResolvedFrame` or a typed unresolved/unsupported result. Placement is never inferred from Body bounds, representation structure, or semantic dimensions.

### Body-local translation

The authored solid's translation relative to the occurrence origin, such as an upper-inner corner or a top-centre Datum. It is Product-local geometry. `semantics.properties.datum` names that intent as metadata and is never executed as a transform.

### Spatial parent world frame

The document-resolved `ResolvedFrame` of the containing spatial node in World coordinates. Low-level representation operations may receive it as an already-resolved input. High-level callers request container-local or World geometry through distinct document queries rather than supplying an arbitrary parent frame.

### Coordinate space

Every geometry-producing boundary names its coordinate space as Product-local, container-local, or World. The evaluator and adapter never exchange an untagged solid whose space must be inferred. Product-local and World queries have distinct return contracts even when both contain the same kernel handle type.

### Spatial node

A node that organizes the built asset spatially. Project, Site, Facility, Facility Part, Building Storey, and Space are distinct spatial concepts. Building Storey and Space are not Facility Parts.

### Facility

A top-level built facility with a typed kind. The first facility abstraction includes Building, Bridge, Road, and Railway together.

### Physical assembly

A physical whole such as a portal frame, truss, or beam grid composed from Products. It is an assembly record, not a Product class or Facility kind. It has document-local identity, a stable occurrence key, occurrence metadata, placement, role intent `FRAME | TRUSS | BEAM_GRID | MARKER | OTHER`, and assembly-location intent `SITE | FACTORY | UNSPECIFIED`. `OTHER` carries a required target-independent label.

An assembly has no Body and explicitly owns `NONE(PHYSICAL_ASSEMBLY_CONTAINER)` outside the Product class map. It relates to children through either unordered aggregation or ordered nesting. Decomposition is separate from spatial containment and never rebases child placement.

### Neutral units

`BimDocument`, Families semantics, Product Body measurements, neutral placements, and `ImportedBimDocument` geometry use millimetres. Derived areas and volumes therefore use square and cubic millimetres. IFC import and export convert exactly once at the validated adapter boundary. The selected IFC output unit does not leak into document, classification, representation, or Product Body contracts.

### Borrowed handle

A live kernel handle whose owner remains elsewhere. Borrowers may inspect or transform it through operations that return new handles. They never dispose it.

### Owned handle

A live kernel handle with one disposal path. Ownership changes only after an explicit successful transfer.

### Imported BIM document

The IFC adapter's read model. It reuses neutral spatial and Product classification vocabulary but owns World-placed reconstruction results, item-level fidelity, and import diagnostics. It remains distinct from the authored Product-local `BimDocument` during this rework.

## Solution

Build neutral placement, document, Product Body, and representation modules inside `brepjs-bim`, then make authoring, IFC, and Families depend on them. Product classification selects semantic adapter behavior. Geometry representation selects validation, measurement, traversal, and cleanup operations. Placeable records own placement definitions, and the document resolves them through the spatial graph. Classification and representation never select placement policy.

The Product Body ticket starts with a bounded placement foundation and closes #2272. The foundation supplies validated Frames, ordered composition, inverse localization, and transactional placement of a Product Body through a caller-supplied resolved Frame. It does not migrate every category or change `brepjs-families`. The same ticket then adopts the successful Body behavior and tests from the research branch while replacing the branch's wall-and-railing-specific Body shape with the final cardinality-independent contract. Follow-up tickets converge stored Bodies and representations, move placement definitions and World resolution into `BimDocument`, introduce the facility-neutral classification model, and refactor the adapters.

The final proof is small: adding first-class Member and Sign must not require changes to Product Body, placement, representation disposal, or aggregate measurement. Once that proof passes, the package publishes curated entrypoints and deletes the existing everything-barrel.

## Target dependency graph

Arrows point from a consumer to a dependency.

```text
brepjs-families
  -> brepjs only

brepjs-bim authoring
  -> BIM document and domain contracts
  -> placement definitions and resolver
  -> Product Body and geometry representation
  -> brepjs geometry operations

brepjs-bim Families adapter
  -> BIM document and domain contracts
  -> neutral placement contracts
  -> authoring commands
  -> brepjs-families public types

brepjs-bim IFC adapter
  -> BIM document read contract
  -> Product classification
  -> placement definitions and resolved Frames
  -> geometry representation readers
  -> validated IFC runtime boundary
  -> web-ifc

COBie adapter
  -> BIM document read contract

IDS
  -> validated IFC reader/runtime

BCF
  -> shared value and error contracts only
```

The BIM document and domain contracts must not import authoring builders, IFC writers, IFC readers, `web-ifc`, Families, COBie, IDS, or BCF. Product Body must depend only on brepjs handle and result contracts, opaque `ResolvedFrame`, and neutral error values. Neutral placement construction, validation, composition, inversion, and resolution must not live under IFC import and must not import `web-ifc` or `brepjs-families`. Families operation folding and IFC entity conversion remain adapter functions around that neutral module.

## Product Body contract

The contract has two independent fields. `items` is a non-empty, read-only collection of owned valid solids. `provenance` is an exhaustive `PARAMETRIC | AUTHORITATIVE` discriminant. The implementation-research branch proved both ingredients, but coupled parametric provenance to one item and authoritative provenance to many. The final contract removes that coupling.

The implementation must construct Product Bodies through owned constructors or transfer operations. It must not accept a caller-mutable collection as the model's stored container. A successful transfer copies the non-empty container while transferring the handles. A failed transfer leaves all input handles caller-owned.

Product Body provides these operations or equivalent cohesive operations:

- construct a parametric Body from one or more newly owned Product-local items;
- adopt an authoritative Body through an atomic ownership transfer;
- expose a borrowed non-empty item view;
- validate that all items are live, valid, pairwise distinct, and not already owned by the target document;
- dispose every owned item exactly once through an owner-only operation;
- create fresh transformed copies from a caller-supplied `ResolvedFrame`;
- dispose every new output and intermediate if a later item returns an error or throws;
- calculate aggregate bounds for a complete Body;
- calculate material volume without changing Body items;
- preflight item traversal into plain data before a serializer commits external state.

Material volume means the volume of the union of Body material. It does not mean the sum of item volumes when items overlap. The implementation may expose an explicitly named item-volume sum for diagnostics, but it must not call that value material volume. A singleton Body is measured directly. A multi-item measurement uses a temporary union that is disposed on success, returned error, or throw and never replaces the stored or exported items. Rigid placement does not affect material volume, so shape quantities run on Product-local geometry unless a quantity explicitly depends on location.

Authoritative wall quantities retain authored nominal Length, Width, and Height from the wall specification and derive NetVolume from the Product Body material volume. They omit gross, footprint, side-area, and weight quantities that cannot be derived reliably from the available history. Quantity derivation completes before the IFC quantity graph is emitted.

The authoritative takeover operation rejects:

- a missing target;
- a target that cannot hold a Product Body;
- an empty collection;
- duplicate handle identity;
- a disposed or invalid handle;
- a handle already owned by the target document, including the Body being replaced;
- replacement of a Body whose authoritative state is immutable under the requested mutation.

After an authoritative wall Body is installed, an opening mutation that would cut it again fails before geometry or relationships change. Existing void and fill relationships remain valid metadata, but the exact Body is not subtracted a second time.

## Geometry representation contract

The representation union starts with four variants:

| Variant                  | Payload                       | Meaning                                                |
| ------------------------ | ----------------------------- | ------------------------------------------------------ |
| `BODY`                   | Product Body                  | Stored, model-owned Product-local Body items           |
| `GENERATED_FLIGHTS`      | Flight generation source      | Stair or ramp geometry generated for the operation     |
| `CURTAIN_WALL_COMPOSITE` | Curtain-wall component source | Panels and mullions with their component-local offsets |
| `NONE`                   | Geometryless reason           | An occurrence that intentionally has no own geometry   |

An occurrence record references one `GeometryRepresentation` and separately stores one `PlacementDefinition`. The representation payload, including Product Body, contains no occurrence placement.

The representation module owns exhaustive operations for:

- application of a caller-supplied `ResolvedFrame` into fresh caller-owned solids;
- owner disposal;
- validation;
- aggregate measurement where meaningful;
- Body-item visitation for serializers and quantity adapters;
- explicit reporting for intentionally geometryless occurrences.

Every operation switches on the representation discriminant and ends with a compile-time `never` check. There is no default that returns an empty collection. `NONE` is a deliberate variant with a reason, so a new geometry-bearing class cannot disappear silently.

Placement resolution is independently exhaustive. Adding a placement variant fails the placement resolver, coordinate-space queries, and both adapters even when the representation union is unchanged.

The legal pairing of Product classification, class-specific payload, and representation is derived from one authoritative `ProductClassDefinitionMap` or equivalent discriminated union. The map prevents illegal combinations from compiling and is distinct from reusable `ProductTypeDefinition` records. Representation lifetime operations still dispatch only on representation, not on Product class.

Serialization traversal returns every emitted style target for every representation variant. The common occurrence pipeline applies an occurrence appearance to those targets. This covers stored Bodies, generated flights, curtain-wall composites, authoritative tessellations, and later representation variants without making Product Body or a Product-class handler own styling policy.

## Placement architecture

A BIM occurrence has classification, representation, and placement. A correct Body at the wrong World location is a false Product. Civil models expose this failure when nested Site, Facility, and Facility Part rotations compose with an internal Body Datum, or when a typed route rebuilds a centred envelope from semantic dimensions. BREP-001 and BREP-014 remain gates on the placement architecture.

### Why placement is load-bearing

Classification answers what the occurrence is. Representation answers how its material is stored. Placement answers how the occurrence relates to the spatial graph. World bounds and spatial comparisons require a resolved World Frame. Material volume and other rigid-transform-invariant shape quantities remain Product-local. A missed internal Datum, a centred replacement Body, or a second placement application produces geometry that no later classifier can repair.

### Target architecture

Product classification, geometry representation, and placement are independent axes. Classification and representation never select placement policy. Placeable records store `PlacementDefinition`, while the document resolver returns opaque `ResolvedFrame` values for geometry operations and adapter projection.

The neutral placement module owns validation, ordered composition, inversion, relative-frame calculation, and placement-definition resolution against neutral positioning references. It has no Families or IFC dependency. The Families adapter maps authored transform operations and reference intent into neutral placement definitions. The IFC adapter maps neutral definitions and resolved Frames into schema entities.

### Composition

```text
occurrenceFrame  = foldInAuthoredOrder(occurrenceTransforms)
productWorldFrame = spatialParentWorldFrame × occurrenceFrame
stored Body       = Product-local geometry, including Datum and item offsets
World solid       = productWorldFrame × stored Body
```

The multiplication convention applies the right-hand operand first. The fold preserves the authored order of `tTranslate` and `tRotate`; it does not impose a fixed translation-before-rotation or rotation-before-translation order. Ancestor placement definitions resolve in spatial-parent order. Intrinsic Body translations and rotations remain geometry and never enter `occurrenceFrame`.

A rotation pivot is transient authoring input to `tRotate`. The ordered fold consumes the pivot while producing the resulting rigid pose. Neither `LOCAL_FRAME` nor `ResolvedFrame` stores a pivot.

BREP-001 remains the composed-transform contract. Nested spatial rotations compose in ancestor order. Cartesian pitch about an arbitrary axis is fully supported by `LOCAL_FRAME`. `GRID_REFERENCE` and `LINEAR_REFERENCE` enter the domain model now so Building, Road, and Railway do not require another placement-record redesign, but complete grid and alignment evaluation remain later work with explicit support states.

### Datum

A Datum is the Body-local origin of the authored solid. It lives in geometry. `semantics.properties.datum` is descriptive metadata. Do not execute it. Do not add a separately authored `bodyDatumOrigin`. Do not infer origin from Body bounds.

A parametric route that synthesizes a centred envelope from length, width, and height while discarding the Body-local Datum is illegal. A parametric recipe must generate its Body in Product-local coordinates with its Datum and centring included. If retained facts cannot reproduce that local geometry, the evaluated Body becomes authoritative through the Product Body contract.

The current adapter may inspect recognized resolver wrappers as a temporary BREP-014 compatibility shim. The shim may remove only occurrence wrappers already represented by explicit transforms and must leave the remaining Body Datum in Product-local geometry. Unexpected wrapper structure fails projection before model mutation. Wrapper inspection is not a target contract and is deleted when typed Families semantics expose occurrence placement and Product-local geometry separately.

### What each layer owns

- The neutral placement module owns `PlacementDefinition`, opaque `ResolvedFrame`, validation, composition, inversion, and typed resolution errors.
- `BimDocument` stores placement definitions and typed positioning references for spatial nodes, Products, and assemblies. It owns reference lookup, parent traversal, and World-frame resolution. Assembly decomposition never rebases child placement.
- Authoring writes Product-local Bodies and target-independent placement intent. It does not bake occurrence yaw or pitch into stored CSG.
- Product Body and representation apply a caller-supplied `ResolvedFrame`. They do not store placement or resolve the spatial graph.
- The Families adapter maps explicit resolved element placement and reference intent into `PlacementDefinition`. At cutover it receives Product-local geometry directly and stops depending on CSG wrapper shape.
- The IFC adapter maps `LOCAL_FRAME` to relative `IfcLocalPlacement`, maps supported `GRID_REFERENCE` and `LINEAR_REFERENCE` definitions to their corresponding placement forms, returns typed capability errors where required positioning data or schema support is absent, and applies composed placement exactly once on import. Imported solids remain World-placed under the current imported-document contract.

### Coordinate-space queries

The document read API exposes distinct container-local and World-placed geometry queries. The World query resolves the occurrence through the actual spatial graph. It does not accept an arbitrary optional parent Frame. Low-level placement functions accept an already-resolved Frame for isolated operation tests, but they cannot claim that it belongs to a particular document occurrence.

Authored, eager, and IFC-imported World bounds are comparable only in World coordinates. Mixing Bridge-Part-local bounds with authored World bounds is an invalid test. Return contracts and test helpers name the coordinate space so the same solid type cannot hide that mismatch.

### Evaluated Body localization

Every evaluated Body crossing into the BIM adapter carries an explicit source-space tag. Product-local inputs need no placement transform. World-space inputs are copied and localized before ownership transfer:

```text
stored = inverse(productWorldFrame) × evaluatedWorldSolid
```

If any solid cannot be localized, projection fails atomically with the Product key path and solid index. It disposes every adapter-owned copy and does not install a parametric envelope. The adapter never applies inverse World placement to an untagged or already Product-local solid.

### Illegal designs

- Inferring placement from Body bounds.
- Storing placement inside Product Body.
- Storing a bare rigid Frame where a placement definition belongs.
- Moving Body-local Datum, centring, or item offsets into occurrence placement.
- Replacing a Datum-bearing Body with a centred semantic envelope.
- Applying occurrence placement to geometry that already includes those occurrence transforms.
- Executing `semantics.properties.datum` as a transform.
- Baking occurrence rotation into CSG after Family validation, then stamping `axisX` and `axisZ`.
- Treating CSG wrapper shape as the permanent Families-to-BIM placement protocol.
- Letting high-level callers choose an unrelated optional parent Frame and still returning a successful World result.
- Flattening a grid- or linear-reference placement into a rigid Frame while discarding its authored reference and parameters.
- Treating `fromIfc` loss of `IfcParameterizedProfileDef.Position` as the same defect as a dropped rotated inner Datum.

### Proof

Placement is the first named sub-deliverable of Ticket 1, not a separate prerequisite PR. That bounded foundation establishes neutral Frame validation and algebra, placement variants, coordinate-space contracts, inverse localization, and transactional Product Body placement through a supplied resolved Frame. It does not migrate every category or change Families source.

Ticket 3 reuses the operation for every representation. Ticket 4 makes `BimDocument` the owner of placement definitions and World resolution. Ticket 6 maps placement through IFC. Ticket 7 replaces wrapper recovery with explicit typed Families placement and Product-local geometry. The cutover remains incomplete until corner, centre, and rotated-inner Datum fixtures match authored, eager World, and IFC-imported World bounds under nested rotated spatial ancestors. BREP-001 remains the control.

## Facility and Product classification model

### Spatial classification

The neutral spatial model distinguishes:

- Project;
- Site;
- Facility with `BUILDING | BRIDGE | ROAD | RAILWAY` kind;
- Facility Part tied to the containing facility kind;
- Building Storey;
- Space.

The first facility ticket introduces all four Facility kinds and their explicit support states together. Bridge receives complete authoring and IFC projection first. Building keeps its established path while moving onto the same facility abstraction and preserving grid-reference placement intent. Road and Railway gain typed spatial shells, containment rules, linear-reference placement intent, placement tests, and explicit unsupported results for unimplemented resolution. They never fall through to Bridge behavior or Proxy.

Portal frames, trusses, and spatial lattices use Physical Assembly plus aggregation or nesting. They are not Facility kinds or Facility Parts. Functional systems and zones use assignment relationships. Physical structural Products and analytical structural members remain separate concepts.

### Product classification

The built-in Product classification is closed and compile-time exhaustive. It includes the existing supported physical classes and later adds Member and Sign. Each class owns a typed class-specific payload and target-independent role vocabulary. Free-form strings and generic property bags may remain as descriptive metadata, but no routing, placement, ownership, IFC entity choice, or required quantity may depend on them.

Each Product class has an explicit typed default or not-defined role. Absence does not fall back to a free-form string. Reusable Product definitions and low-level IFC type grouping use this closed role intent, never descriptive occurrence metadata.

IFC entity names, IFC enum literals, schema availability, standard property-set names, and type-object mapping belong to the IFC adapter. External classification references remain associations on the document and do not select the Product class.

Adding a built-in Product class must fail typecheck until `ProductClassDefinitionMap` and the implementation supply:

- the Product-class definition entry and legal representation set;
- authoring support or an explicit non-authorable state;
- IFC export classification behavior;
- IFC import classification behavior;
- schema support;
- type-object and predefined-type policy;
- validation policy;
- focused and round-trip tests.

## BimDocument and authoring responsibilities

### BimDocument

`BimDocument` is the neutral, authored, Product-local model. It owns:

- document-local record identities;
- stable occurrence keys;
- optional occurrence metadata;
- reusable `ProductTypeDefinition` records and occurrence-to-definition references;
- neutral surface appearances and Product-level appearance assignments;
- spatial, Product, assembly, group, and relationship records;
- Bodyless Physical Assembly records with explicit aggregation or ordered-nesting relationships;
- one `PlacementDefinition` for every placeable record;
- stable typed grid and linear positioning-reference records used by parametric placement definitions;
- spatial-parent traversal and placement resolution into container-local and World `ResolvedFrame` values;
- Product classification and class-specific payloads;
- geometry representations and every stored kernel handle;
- atomic representation replacement and ownership transfer;
- read-only queries used by adapters;
- distinct Product-local, container-local, and World geometry queries;
- referential-integrity checks that do not require IFC;
- deterministic, idempotent document disposal.

`BimDocument` does not parse authoring specifications, generate parametric solids, know Families types, expose IFC writer types, own IFC file metadata, or call `web-ifc`.

The read contract should expose iterable records and relationships rather than one getter per Product class. Category-specific convenience queries may exist above the read contract, but adapters must not require them.

Document validation rejects duplicate occurrence keys, incompatible reuse of a Product type definition key, removal of a referenced definition, and a Product whose definition classification, role, or payload is incompatible. It also rejects missing or wrong-kind positioning references, placement cycles, non-rigid `LOCAL_FRAME` values, malformed grid or linear parameters, and unsupported placement definitions at operations that require resolution. Replacing a Product representation preserves its occurrence metadata, type-definition reference, appearance assignment, and placement definition.

Assembly validation rejects missing or duplicate children, self-reference, decomposition cycles, and more than one decomposition parent for a child. An assembly must have at least one child at final validation. Creation may be atomic with children or temporarily incomplete inside a document transaction, but invalid intermediate state must not escape a successful command.

### Authoring

The authoring layer owns:

- parsing and validating authoring inputs;
- parametric specifications and recipes;
- target-independent rigid and parametric placement definitions;
- generating stored Product-local Bodies;
- generated-flight and curtain-wall representation sources;
- opening and filling commands;
- convenience commands such as adding a Wall, Bridge, Member, or Sign;
- explicit optional reusable type-definition references for low-level Product authoring;
- building a document transactionally and disposing partial results on error or throw.

Authoring writes through narrow document operations. It does not mutate document maps directly. A failed command leaves the document and caller ownership unchanged.

### Imported BIM document

IFC import returns an `ImportedBimDocument` during this rework. It shares neutral classification, spatial, and placement vocabulary but owns World-placed reconstructed geometry, source express IDs, source placement identity and parameters where supported, completeness, fidelity, and diagnostics. Imported geometry exposes its item collection directly and does not preserve the legacy scalar-solid alias.

An optional future normalization operation may convert a complete imported document into an authored Product-local `BimDocument`. That conversion is not required by this spec.

## IFC adapter boundary

The IFC adapter contains import and export under one public capability. IFC import is not a separate package entrypoint.

The adapter has five internal responsibilities:

1. A validated runtime boundary converts untrusted `web-ifc` records into named local wire values. Raw `any` or `Record<string, unknown>` values stop at this boundary. The boundary also captures backend diagnostics. Serialization reports success only when no error-level diagnostic was emitted; a genuine invalid lookup or write becomes a typed error naming the responsible entity or operation. Tests and implementation must not suppress backend error reporting globally.
2. A graph scheduler writes contexts and spatial parents before Products, then relationships, types, materials, styles, classifications, quantities, and final bytes in dependency order.
3. Closed schema-aware handler tables map neutral Facility and Product classifications to IFC entities, predefined types, type objects, property sets, quantities, and class-specific relationships.
4. A placement encoder and decoder map neutral placement definitions to IFC placement entities and source positioning records. `LOCAL_FRAME` is fully supported. `GRID_REFERENCE` and `LINEAR_REFERENCE` map when the target schema and referenced positioning data are sufficient; otherwise they preserve imported source intent where possible or return a typed schema-capability error. The adapter never silently flattens them.
5. A separate representation encoder maps geometry representations to IFC representations and Body items. Product handlers delegate geometry to this encoder.

Product handlers write authored occurrence metadata where the target entity supports it. They generate a numbered fallback name only when `name` is absent; fallback names do not affect occurrence identifiers, Product classification, or type grouping.

When an occurrence references a reusable definition, IFC type grouping uses its compatible `(IFC class, predefined-type intent, definitionKey)` and equal keys share one deterministic type object. Different definition keys produce different type objects even when classification and role match. An occurrence without a definition reference uses the documented deterministic `(IFC class, predefined-type intent)` fallback. That fallback may intentionally group unrelated low-level occurrences, never creates a `ProductTypeDefinition` in `BimDocument`, and never considers metadata, Body shape, provenance, placement, or appearance.

The representation encoder returns every emitted styleable representation item. The common occurrence writer applies the selected Product appearance to every returned target, including every item in parametric, authoritative, multi-item, and tessellated Bodies. An unstyled Product receives no synthetic style.

A neutral Physical Assembly maps to `IfcElementAssembly`. Its role and assembly-location intent map independently through the IFC handler. The assembly emits no synthetic Body, uses `NONE(PHYSICAL_ASSEMBLY_CONTAINER)`, and retains its unordered aggregation or ordered-nesting relationship to typed children.

The exporter preflights every authoritative Body item before committing the owning Body representation. Each Body item becomes one IFC representation item. Export never fuses items to simplify writing. A later preflight failure reports the Product and item index, emits no partial Body representation, leaves model-owned inputs live, and closes the IFC model exactly once.

The importer traverses every IFC Body item independently. It preserves source item identity and records one result per item, including reconstructed solid, retained lossy mesh, or diagnostic. It reports:

- `COMPLETE` when every source Body item reconstructed;
- `PARTIAL` when at least one item reconstructed and at least one did not;
- `NONE` when a Body existed but no item reconstructed;
- a distinct no-Body state for an occurrence with no Body representation.

Only a complete Body has authoritative aggregate bounds and material volume. Partial results retain successful items and item-specific diagnostics but do not claim complete aggregates. Multi-item lossy and mixed solid/mesh results retain every successful item rather than one scalar mesh side channel.

Each supported closed tessellated item reconstructs independently as a solid, irrespective of Product classification. An open or unsupported tessellation retains its lossy mesh and an item-specific diagnostic while successful siblings remain available. The adapter owns the lifecycle of foreign runtime values and must not assume they implement a `delete()` method. The particular backend cleanup mechanism is not a neutral domain concept.

Import classification is graph-aware. A standalone `IfcMember` becomes a Member Product. An `IfcMember` generated as a curtain-wall constituent remains a composite constituent and must not become a duplicate authored Member. Unsupported IFC Products remain identifiable with diagnostics; they do not disappear because an entity type was absent from a static loop.

Import preserves source IFC type-object identity and relationships. It does not promise to recover an opaque authored `definitionKey` unless a later explicit reversible encoding is specified.

## Families adapter boundary

The typed built-asset semantics cutover is the only ticket that changes `brepjs-families`.

`brepjs-families` defines target-independent semantics for:

- Site;
- Facility with Building, Bridge, Road, or Railway kind;
- Facility Part;
- Building Storey;
- Space;
- typed physical Product;
- target-independent placement intent for spatial nodes, Products, and assemblies;
- occurrence metadata;
- an explicit stable reusable Product `definitionKey` or resolved `definitionKey(props)` value;
- Bodyless Physical Assembly with role intent, assembly-location intent, child references, and explicit aggregation or ordered-nesting relationship;
- relationship intent needed for containment, aggregation, nesting, and grouping.

The semantics contract must not import `brepjs-bim`, Product Body, `web-ifc`, IFC enums, or IFC schema identifiers. Material and dimensions are class-specific optional data, not universal Product requirements. Route-critical data uses discriminated variants and typed fields rather than arbitrary category strings, role strings, or `unknown` property bags.

The BIM Families adapter consumes resolved semantics and produces neutral document commands. It maps classification, representation, and placement independently. It may evaluate Family geometry, create adapter-owned Product-local copies, compare a parametric candidate with the evaluated Body, and transfer an authoritative Body. It does not map directly to IFC enums.

The adapter derives occurrence placement only from explicit resolved element semantics. Ordered occurrence transforms become `LOCAL_FRAME`; declared grid-relative semantics become `GRID_REFERENCE`; declared alignment-relative semantics become `LINEAR_REFERENCE`. Body Datum transforms remain Product-local geometry. The adapter must not recenter a Body from envelope dimensions or bounds. Translation and rotation of an occurrence therefore preserve any translated or rotated internal Datum.

Before the typed cutover, the adapter may use the bounded wrapper-recovery shim needed for BREP-014. At cutover, resolved Families output exposes placement intent and Product-local geometry separately. The adapter deletes wrapper inspection. If an evaluator still returns an explicitly World-tagged Body, the adapter localizes a copy by the inverse resolved World Frame before ownership transfer. It never applies that inverse to Product-local input.

At cutover, remove `civilSemantics()`, free-form civil route tables, display-name routing, and the old whole-model civil-mode switch. Do not retain compatibility aliases. Bridge is the first complete projection. Building, Road, and Railway semantics remain typed and return explicit unsupported errors for missing projection behavior.

## Ownership, placement, and cleanup invariants

1. Every live kernel handle has exactly one owner.
2. Borrowers never dispose handles.
3. Ownership transfers only after an explicit successful operation.
4. A failed transfer leaves every input caller-owned and the document unchanged.
5. A successful transfer gives the document one copied, immutable container of the transferred handles.
6. A document rejects handles already owned anywhere in that document, including the representation being replaced.
7. Evaluator and topology-cache handles remain borrowed. The Families adapter clones before retaining, normalizing, or transferring geometry.
8. Adapter clone, validation, normalization, comparison, and transfer steps clean their own intermediates on returned errors and thrown exceptions.
9. Stored Product Bodies are Product-local. Body Datum, generator centring, and item-local offsets remain part of Product-local geometry.
10. Every placeable element and spatial record owns exactly one `PlacementDefinition`; Product Body owns none.
11. `LOCAL_FRAME`, `GRID_REFERENCE`, and `LINEAR_REFERENCE` are independently valid placement definitions. Representation kind, Body cardinality, provenance, and Facility kind do not select a placement variant.
12. A `ResolvedFrame` is finite, rigid, right-handed, non-degenerate, and validated before any kernel operation begins. Scale, shear, reflection, parallel axes, and invalid numeric values are rejected.
13. Families occurrence operations are folded in authored order. The implementation never reduces an ordered transform program to a fixed translation-then-rotation assumption.
14. BimDocument resolves spatial ancestors and occurrence placement exactly once to produce container-local or World `ResolvedFrame` values.
15. `GRID_REFERENCE` and `LINEAR_REFERENCE` preserve their target-independent positioning references and parameters even where resolution or projection is unsupported. They are never silently flattened to arbitrary `LOCAL_FRAME` values.
16. High-level geometry queries select Product-local, container-local, or World coordinates explicitly. A World query does not accept a caller-supplied optional parent frame.
17. Low-level representation placement accepts an already validated `ResolvedFrame`; it does not inspect the spatial graph or semantic Product category.
18. `placeProductBody` or its equivalent borrows stored items and returns fresh caller-owned solids in the requested resolved coordinate space.
19. A failure or throw on item `n` disposes outputs and intermediates created for items `0..n` without touching stored inputs.
20. Material volume and other shape-only quantities derive from Product-local geometry. World bounds and other location-dependent queries use document-resolved placement.
21. An evaluated Body crosses the authoring boundary with an explicit source-space tag. Product-local input is retained as local; World input is inverse-localized on a fresh copy before transfer.
22. Inverse localization and ownership transfer are atomic. Failure leaves the caller's source live, disposes adapter intermediates, and leaves the document unchanged.
23. IFC serialization borrows document geometry and never disposes it.
24. IFC preflight stores only plain mesh and quantity data before commit.
25. The IFC writer closes its model exactly once after save success, save failure, returned error, or throw.
26. IFC import owns each reconstructed item locally until it transfers the item to the imported document.
27. Item-local import failure disposes only that item's intermediates and preserves successful siblings.
28. Element-level failure disposes geometry accumulated for that element.
29. Fatal import failure disposes geometry accumulated for all earlier elements.
30. Indexes are borrowed views and never create disposal paths.
31. Disposal tests count calls as well as checking disposed state because idempotent disposal can hide double ownership.
32. Representation replacement preserves occurrence identity, metadata, reusable type reference, appearance assignment, and placement definition.
33. Assembly aggregation and nesting never alter or rebase child placement.
34. Neutral values remain in millimetres; IFC import and export apply unit conversion exactly once at the runtime boundary.
35. Names, tags, geometry, placement, provenance, and appearance never determine occurrence keys or reusable type identity.
36. Occurrence placement is applied exactly once. Geometry that already includes occurrence transforms is not accepted as Product-local geometry.
37. Before the Families cutover, missing or malformed resolver transform wrappers fail projection closed. A parametric envelope is not a fallback.
38. Resolver-wrapper inspection is a temporary BREP-014 migration shim, not a neutral placement API, and is deleted at the typed Families cutover.

## User Stories

1. As a bridge author, I want an evaluated disconnected railing Body preserved, so that IFC volume and bounds match the authored Family.
2. As a bridge author, I want a directly cut wall Body preserved, so that a parametric envelope does not refill the cut.
3. As a BIM author, I want an exact Body to retain one or many items, so that disconnected material does not require an artificial boolean union.
4. As a BIM author, I want a parametric Body to retain one or many items, so that cardinality does not imply provenance.
5. As a BIM author, I want Product classification independent from representation, so that Wall, Member, and Sign can use the same Body policy.
6. As a BIM author, I want placement stored on the occurrence graph, so that Body items cannot be double-placed.
7. As a geometry caller, I want fresh World-placed solids, so that I own outputs without mutating model geometry.
8. As a geometry caller, I want all partial placement outputs cleaned on failure, so that a later-item error does not leak kernel handles.
9. As a model owner, I want every stored handle disposed once, so that document lifetime is deterministic.
10. As a model owner, I want failed takeover to preserve caller ownership, so that errors do not create ambiguous ownership.
11. As a model owner, I want takeover to reject already-owned handles, so that a successful call cannot install a disposed or multiply owned Body.
12. As an IFC consumer, I want one IFC Body item per retained Body item, so that item structure survives round trips.
13. As an IFC consumer, I want typed occurrences to keep their IFC class when their Body is exact, so that geometry fidelity does not downgrade semantics.
14. As an IFC consumer, I want aggregate material volume to use the material union, so that overlapping items are not double-counted.
15. As an IFC consumer, I want nominal exact-wall dimensions and measured NetVolume distinguished, so that quantities state what they represent.
16. As an IFC consumer, I want unavailable exact-wall quantities omitted, so that the exporter does not invent footprint, gross, or weight facts.
17. As an IFC importer, I want every supported Body item reconstructed independently, so that later siblings are not ignored.
18. As an IFC importer, I want partial Bodies to retain successful items and diagnostics, so that one unsupported item does not erase valid geometry.
19. As an IFC importer, I want multiple lossy or mixed items retained, so that a scalar mesh fallback does not discard geometry.
20. As an IFC importer, I want World placement applied once per item, so that imported bounds agree with eager authored bounds.
21. As an IFC importer, I want a standalone Member distinguished from a curtain-wall constituent, so that classification follows graph context.
22. As a package maintainer, I want adding a Product class to break typecheck at every required semantic mapping, so that omissions cannot ship silently.
23. As a package maintainer, I want adding a representation variant to break placement, disposal, validation, measurement, and writer compilation, so that lifecycle behavior stays exhaustive.
24. As a package maintainer, I want geometryless cases represented explicitly, so that an unhandled geometry-bearing class cannot return an empty array.
25. As a package maintainer, I want one Product-class definition source of truth, so that category, payload, and legal representation lists cannot drift.
26. As a package maintainer, I want neutral model types to avoid IFC imports, so that IFC remains an adapter rather than the owner of the domain.
27. As a package maintainer, I want neutral placement algebra outside IFC import, so that authoring and Families do not depend on `web-ifc`.
28. As an authoring API user, I want document storage separate from geometry-building commands, so that read adapters do not depend on every builder.
29. As an adapter implementer, I want iterable document records instead of one getter per class, so that adding a class does not expand every consumer API.
30. As a Families author, I want typed built-asset semantics, so that renaming a Family does not change its BIM meaning.
31. As a Families author, I want invalid Facility and Product combinations rejected by types or parsing, so that routing does not depend on string conventions.
32. As a Families maintainer, I want the package independent from BIM and IFC, so that Families remains reusable for non-IFC targets.
33. As a building author, I want Building, Building Storey, and Space modeled distinctly, so that infrastructure Facility Part rules do not distort building hierarchy.
34. As a road author, I want Road present in the first facility abstraction, so that Bridge assumptions do not become generic construction policy.
35. As a railway author, I want Railway present in the first facility abstraction, so that later linear-infrastructure work does not require another facility redesign.
36. As a bridge author, I want Bridge implemented first without creating bridge-only core types, so that current priorities do not restrict the general model.
37. As an assembly author, I want portal frames and trusses modeled as physical assemblies, so that they are not misclassified as Facilities or spatial parts.
38. As an IFC exporter maintainer, I want class handlers separate from representation encoders, so that entity policy cannot own Body lifetime.
39. As an IFC exporter maintainer, I want graph scheduling separate from class handlers, so that placement and relationship ordering remain explicit.
40. As an IFC runtime maintainer, I want raw `web-ifc` values parsed at one boundary, so that `any` and unchecked records do not spread through the adapter.
41. As a contributor adding Member, I want to edit classification, authoring, IFC mapping, and tests only, so that Member proves the architecture is scalable.
42. As a contributor adding Sign, I want to reuse the same Body and placement operations as existing Products, so that Sign proves classification and representation independence.
43. As a package consumer, I want a small model or authoring import that does not load IFC, so that non-IFC use avoids `web-ifc` runtime cost.
44. As a package consumer, I want IFC import and export under one explicit entrypoint, so that schema/runtime requirements are clear.
45. As a package consumer, I want the Families adapter under an explicit entrypoint, so that its type dependency is opt-in.
46. As a package consumer, I want BCF, COBie, and IDS under focused entrypoints, so that unrelated standards code is not part of the default import.
47. As a release maintainer, I want each packed entrypoint tested through ESM, CJS, and declarations, so that source resolution shortcuts cannot hide publishing failures.
48. As a repository maintainer, I want all changes to remain atomic across BIM, Families, tests, docs, and playground types, so that the monorepo continues to reduce coordination cost.
49. As an author, I want typed Products to retain authored occurrence metadata, so that IFC names and tags do not become category counters.
50. As a type author, I want reusable Product identity separate from occurrence identity, so that distinct Family definitions do not collapse into one IFC type.
51. As a model author, I want one Product appearance applied to every emitted representation item, so that compound, generated, and exact Bodies are styled consistently.
52. As a Families author, I want a Bodyless Physical Assembly with typed children, so that declarative assemblies do not require low-level model mutation.
53. As a Families author, I want rotated Bodies to retain their internal Datum, so that typed projection preserves authored World bounds.
54. As an IFC caller, I want successful export to emit no error-level backend diagnostics, so that success is distinguishable from a failed write.
55. As a bridge author, I want nested rotated spatial Frames composed with a pitched Product Datum, so that World bounds use the document-resolved Product pose.
56. As a model author, I want placement definitions independent from representation, so that replacing a generated Body with an authoritative Body cannot move the occurrence.
57. As a road or railway author, I want an alignment-relative placement to retain its reference and offsets even before full projection is implemented, so that early models do not lose parametric intent.
58. As an authoring API user, I want rigid and parametric placement represented distinctly, so that a resolved matrix is not mistaken for the authored placement definition.
59. As a geometry caller, I want Product-local and World queries to be different operations, so that an optional parent frame cannot silently select the wrong coordinate space.
60. As a model owner, I want invalid or non-rigid frames rejected before geometry mutation, so that placement cannot introduce scale, shear, reflection, or undefined coordinates.
61. As a quantity consumer, I want material volume computed from Product-local geometry, so that moving an occurrence cannot change shape-only quantities.
62. As a Families maintainer, I want ordered occurrence transforms exposed separately from Product-local Body Datum, so that the BIM adapter does not inspect implementation-specific CSG wrappers.
63. As a package maintainer, I want adding a placement variant to break every resolver and adapter mapping at compile time, so that unsupported placement cannot silently become identity placement.
64. As a building author, I want placement at a named grid intersection to retain its axis references and offsets, so that Building support is not forced through an infrastructure-only or rigid-frame model.

## Implementation Decisions

### Internal module boundaries

- Introduce domain, placement, document, Product Body, representation, authoring, IFC, Families-adapter, and standards boundaries inside the existing npm package.
- Enforce allowed imports with a BIM-specific dependency check. Existing source folder names are not automatically public modules.
- Move neutral placement definitions, resolved-frame validation and algebra, style, material, relationship, identity, and document record values below the adapters.
- Keep neutral placement independent from IFC, Families, Product classification, Product Body, and kernel-handle ownership. Adapters translate their source placement values at the boundary.
- Keep IFC file metadata and IFC enum types inside the IFC adapter.
- Keep error values typed and adapter-specific while sharing only neutral error structure below the adapters.

### Migration sequence

Each ticket must leave tests, typecheck, and boundary checks green. The sequence may use multiple reviewable commits, but it must not rely on a separate prerequisite branch for #2272.

1. **Placement foundation, Product Body, and #2272.** Execute this as one ticket with three ordered internal checkpoints. Each checkpoint's focused tests must pass before the next begins.
   1. **Placement foundation.** Establish the closed `PlacementDefinition` union, opaque validated `ResolvedFrame`, rigid-frame algebra, authored-order composition, coordinate-space contracts, inverse localization, and transactional Product Body placement through a supplied resolved frame. Fully resolve `LOCAL_FRAME`. Validate and preserve `GRID_REFERENCE` and `LINEAR_REFERENCE`, but return typed unsupported when asked to resolve them. Do not implement grid geometry, alignment evaluation, or IFC reference-placement mapping.
   2. **Product Body.** Build the final cardinality-independent Product Body module and prove its ownership, placement, validation, disposal, aggregate quantities, and returned-error and thrown-exception cleanup contracts.
   3. **Takeover and round trip.** Activate authoritative takeover for the affected typed Wall and Railing paths. Move their traversal, placement transaction, validation, disposal, quantities, multi-item IFC writing, bounded all-item import, and ownership cleanup behind the new seam. Port and strengthen the research branch's regression tests. The two-item guardrail and directly cut wall must survive the writer's tessellated representation item-by-item. This is the narrow BREP-013 behavior required for an honest #2272 round trip, not the general importer refactor.

   This ticket includes `Fixes #2272`, does not migrate every representation or Product class, and changes no `brepjs-families` source.

2. **Stored-Body convergence.** Migrate every model-owned solid-backed Product to Product Body. Remove category-specific single-solid ownership conventions, including arbitrary solids hidden in specifications. Keep generated flights, composite curtain walls, and intentional no-geometry cases separate for the next ticket.
3. **Exhaustive representation.** Introduce the complete geometry representation union and central operations. Remove category lists from placement, disposal, geometry validation, quantity traversal, and IFC Body traversal. Every representation places through the ticket 1 frame contract. Make representation serialization traversal return every emitted style target for the common occurrence pipeline. Delete silent default handling and the high-level optional-parent-frame API.
4. **BIM document and authoring split.** Move records, relationships, placement definitions, spatial graph resolution, representation ownership, coordinate-space queries, and disposal into `BimDocument`. Establish neutral occurrence identity and metadata, reusable Product type definitions, appearance assignments, and Bodyless Physical Assembly records with validated decomposition relationships. Move parsers, recipes, geometry generation, and convenience commands into authoring. Replace per-class adapter getters with the neutral read contract. This moves the existing behavior once before its classification axis is replaced; it must not create a second parallel model.
5. **Classification and facility model.** Add neutral Product classification, `ProductClassDefinitionMap`, typed roles, type-definition compatibility, explicit relationship semantics, and the shared Building, Bridge, Road, Railway facility abstraction. Migrate existing Building and Bridge behavior onto the document from ticket 4. Building spatial shells accept `LOCAL_FRAME` and preserve `GRID_REFERENCE`. Road and Railway spatial shells accept `LOCAL_FRAME` and preserve `LINEAR_REFERENCE`. Each returns typed unsupported results where positioning-reference geometry, resolution, or authoring is not implemented.
6. **IFC adapter refactor.** Add the validated runtime boundary, graph scheduler, facility handlers, Product handlers, independent representation encoder, and placement encoder and decoder. Migrate existing classes in reviewable groups. Add occurrence metadata mapping, deterministic reusable-type grouping, all-item appearance assignment, Physical Assembly mapping, and unit conversion at the boundary. Map `LOCAL_FRAME` fully. Map `GRID_REFERENCE` and `LINEAR_REFERENCE` where the schema and neutral positioning records provide sufficient information; otherwise preserve supported source intent or return a typed schema-capability error. Never flatten a reference placement silently. Complete the general BREP-013 behavior with class-independent, item-by-item reconstruction for closed Proxy and Earthworks Fill tessellations while retaining open or unsupported items as lossy results with diagnostics. Satisfy the BREP-006 gate: the representative successful export emits no error-level backend diagnostics, while a genuine invalid operation returns a typed error without global suppression.
7. **Typed built-asset semantics cutover.** Change `brepjs-families` once. Add target-independent typed semantics, target-independent placement intent, occurrence metadata, explicit stable definition keys, and Physical Assembly semantics, then update resolution. Change the BIM Families adapter to map classification, representation, and placement independently. Preserve BREP-014 corner-, centre-, and rotated-inner-Datum behavior across authored, eager placed, and IFC-imported World bounds. Replace CSG-wrapper recovery with explicit occurrence placement and Product-local geometry. Delete `civilSemantics()`, free-form routing, display-name fallback, wrapper inspection, and the whole-model civil switch in the same breaking change.
8. **Member and Sign probes.** Add first-class Member and Sign through the completed seams and satisfy BREP-002 and BREP-003 through the replacement API. The probes require typed IFC entities and types, predefined intent, exact Body support, occurrence metadata, material, placement, and round trips; they do not require legacy names such as `BimCategory`, per-class specs, or per-class getters. Neither probe may modify Product Body lifetime operations, placement definitions or resolution, representation disposal, or aggregate measurement. A required edit there fails the probe and reopens the responsible architecture ticket.
9. **Package entrypoints.** After both probes pass, replace the public barrel with curated build entries, migrate repository callers and documentation, add packed-consumer gates, and release the breaking API without compatibility re-exports.

### Ticket gates

- The placement foundation is complete only when its module imports neither Families nor IFC; invalid or non-rigid frames and malformed reference parameters fail before mutation; all three initial variants are exhaustively represented; `LOCAL_FRAME` resolves fully; `GRID_REFERENCE` and `LINEAR_REFERENCE` preserve their values but return typed unsupported from resolution; authored transform order, parent composition, inversion, and Product-local versus World query semantics are characterized; and Product Body placement consumes only a supplied `ResolvedFrame`. Ticket 1 contains no grid geometry, alignment evaluation, or IFC reference-placement mapping.
- The Product Body ticket closes #2272 only after eager and IFC round trips match the authoritative Family Body for classification, item count, World bounds, Product-local material volume, resolved-frame placement, and ownership, including item-by-item reconstruction of the two writer-emitted tessellated regressions. Document-owned World resolution replaces the interim supplied-frame call in ticket 4 without changing Product Body.
- Stored-Body convergence is complete only when no Product stores an owned solid through a separate lifetime convention.
- Representation is complete only when every occurrence has one explicit representation variant, all variants use the resolved-frame contract, high-level geometry queries do not accept an arbitrary parent frame, and adding a variant fails all lifecycle operations at compile time.
- Classification is complete only when adding a Product class fails every required adapter mapping at compile time.
- Facility abstraction is complete only when Building, Bridge, Road, and Railway spatial fixtures exercise hierarchy and placement; Building preserves `GRID_REFERENCE`; Road and Railway preserve `LINEAR_REFERENCE`; and unimplemented resolution is reported explicitly.
- The document split is complete only when occurrence metadata, Product type definitions, appearance assignments, Physical Assembly records, decomposition relationships, placement definitions, graph resolution, and explicit coordinate-space queries are neutral document concepts; World queries resolve their own graph context; and model/domain code imports no writer, reader, Families, COBie, IDS, BCF, or `web-ifc` module.
- IFC refactoring is complete only when Product handlers contain no representation lifetime, placement algebra, or appearance-fan-out logic; representation encoders contain no Product-class policy; placement handlers map the declared variants without representation policy; equal compatible definition keys group deterministically while distinct keys remain distinct; every emitted representation item receives the selected appearance; Bodyless Physical Assemblies serialize without synthetic Bodies; closed Proxy and Earthworks Fill tessellations reconstruct item-by-item; open items retain focused lossy diagnostics and successful siblings; and the BREP-006 representative successful export produces no error-level backend diagnostics.
- Families cutover is complete only when authored metadata, explicit Family definition identity, Physical Assembly semantics, target-independent placement intent, and BREP-014 internal Body Datums survive document-resolved World projection, including nested rotated spatial ancestors; the Families package has no BIM, Product Body, `web-ifc`, or IFC-enum dependency; and the adapter has no wrapper inspection or legacy routing fallback.
- The probe phase is complete only when Member and Sign require bounded classification and adapter additions and no placement-core edit.

## Testing Decisions

### Primary acceptance seam

Use one high-level table-driven seam for the behavior that matters most:

```text
resolved typed Family
  -> BIM Families adapter
  -> authored BimDocument
  -> document-resolved fresh World-placed solids
  -> IFC export
  -> IFC import
  -> imported document-resolved World Body items and diagnostics
```

For every row, assert typed classification, representation provenance, Body-item count, World bounds, material volume, Product placement, IFC entity and predefined type, IFC Body-item count, imported completeness, and imported item count. Do not snapshot STEP text. Inspect target entities and representations through the IFC reader.

For rows introduced after the document and adapter tickets, also assert occurrence metadata, reusable type-object identity, appearance coverage, and deterministic identifiers where applicable. Literal opaque `definitionKey` round-trip is not required because import preserves source IFC type-object identity rather than an authored private key.

The first rows are the two #2272 reproductions from implementation research:

- a disconnected two-item guardrail;
- a directly cut wall with a through-slot.

Both use non-identity Product and spatial placement. Controls include a coincident parametric railing, a parametric wall with a registered opening, equal-volume but spatially different Bodies, and established parametric bridge Products.

The Families cutover adds rectangular typed Products with corner and centre Datum offsets and a pitched Product with a rotated inner Datum. Compare authored, document-resolved eager, and IFC-imported World bounds under non-identity spatial and Product transforms. Resolve the containing spatial graph through the World query; do not pass a caller-supplied parent frame. Include nested rotated Site, Facility, or Facility Part ancestors. Keep the existing BREP-001 composed-placement regression as a control.

### Placement tests

- Reject non-finite coordinates, zero-length axes, parallel or non-orthogonal axes, scale, shear, and reflection before creating or mutating kernel geometry.
- Verify identity, translation, rotation about a non-default axis and pivot, arbitrary Cartesian pitch, inversion, and nested parent composition.
- Verify ordered Families occurrence operations with at least two non-commuting transforms. The expected result follows authored order rather than a fixed translate-then-rotate factorization.
- Verify `LOCAL_FRAME` round trips through document storage and resolution without exposing an unchecked matrix.
- Verify `GRID_REFERENCE` preserves grid identity, two axis references, two- and three-offset forms, and reference direction. Missing axes, duplicate axes, or an unresolved grid returns a typed result without replacing the definition or treating it as identity.
- Verify `LINEAR_REFERENCE` preserves reference identity, distance-along, lateral, vertical, and longitudinal offsets, and orientation. Unsupported projection returns a typed result without replacing the definition or treating it as identity.
- Verify Product-local, container-local, and World queries are distinct and cannot be selected through an omitted or optional parent argument.
- Verify World resolution across nested spatial ancestors, including a rotated ancestor and pitched Product, applies each definition exactly once.
- Verify Product-local and explicitly World-tagged evaluator results take different localization paths. World input is inverse-localized on a fresh copy; Product-local input is not.
- Verify failed inverse localization, returned placement errors, and thrown kernel exceptions dispose all adapter-created intermediates and leave source and document ownership unchanged.
- Verify moving an occurrence leaves material volume and other shape-only quantities unchanged while changing World bounds as expected.
- Characterize the temporary BREP-014 wrapper-recovery shim before the Families cutover. At cutover, replace those tests with proof that explicit resolved placement and Product-local geometry are consumed and no wrapper shape is inspected.
- Add compile-only coverage proving that a new placement variant cannot omit document resolution, IFC mapping, Families mapping, validation, or exhaustive error handling.

### Product Body and ownership tests

- Test one-item and multi-item Bodies under both provenance variants.
- Test atomic takeover success and every rejection case.
- Test alias rejection when an incoming handle is already document-owned.
- Count exact disposal calls for superseded, transferred, rejected, and document-owned handles.
- Test returned-error and thrown-exception cleanup at a later Body item.
- Test that placement outputs are fresh and caller-owned while inputs stay live.
- Test that exact wall opening rejection changes neither representation nor relationships.
- Test singleton measurement without union and multi-item union disposal on every exit.
- Test overlapping items so material volume differs from item-volume sum.

Use real kernel operations for success. Add a narrow package-internal fault hook only for an otherwise unreachable deterministic later-item failure. Do not mock the entire brepjs module.

### Representation and compile-time tests

- Table-test each representation variant through placement, disposal, validation, measurement, and serialization traversal.
- Add compile-only fixtures that fail if a new representation variant lacks an exhaustive branch.
- Add compile-only fixtures that fail if a new Product class lacks `ProductClassDefinitionMap` and adapter mappings.
- Add compile-only coverage proving that a new representation variant cannot omit style-target traversal.
- Verify `NONE` cases explicitly and prove that no geometry-bearing case can return an empty success by default.

### Document and domain tests

- Verify document-local record identity, stable occurrence keys, and occurrence metadata are independent; renaming or retagging never changes deterministic occurrence identity.
- Verify absent optional metadata is distinct from invalid empty or whitespace-only metadata.
- Verify one `ProductTypeDefinition` can serve compatible occurrences, while duplicate keys with incompatible classification, role, or payload fail with typed errors.
- Verify a referenced type definition cannot be removed and representation replacement preserves the type reference.
- Validate appearance ranges, the one-appearance-per-Product rule, and preservation across representation replacement.
- Validate Bodyless assembly creation, atomic non-empty completion, missing and duplicate children, self-reference, cycles, multiple decomposition parents, and the difference between unordered aggregation and ordered nesting.

### IFC tests

- Verify `LOCAL_FRAME` export and import preserve the resolved rigid pose through nested spatial placement.
- Verify supported `GRID_REFERENCE` data preserves its grid, intersecting axes, offsets, and reference direction. Insufficient positioning data returns a typed capability error and does not emit a flattened local placement.
- Verify supported `LINEAR_REFERENCE` data preserves its reference identity and parameters. An unsupported schema or projection path returns a typed capability error and does not emit a flattened local placement.
- Verify import retains source placement identity and parameters where the schema and adapter support them, independently from imported geometry representation.
- Verify one tessellated IFC item per authoritative Body item.
- Verify two-phase preflight commits no partial Body representation on a later-item failure.
- Verify model inputs remain borrowed and live after successful and failed serialization.
- Verify writer close occurs once for save success, save error, early typed error, and throw.
- Verify complete one-item, complete multi-item, partial, none, no-Body, mixed solid/mesh, and multiple-lossy-item imports.
- Verify element-level and model-level import cleanup.
- Verify graph-aware distinction between a standalone Member and a curtain-wall Member constituent.
- Verify unsupported IFC Products remain represented by diagnostics rather than disappearing.
- Verify authored `name`, `description`, `objectType`, and `tag`, generated missing-name fallback, and that presentation values never change occurrence or type identifiers.
- Verify occurrences using the same compatible definition key share one deterministic type object; different definition keys with the same classification and role remain distinct; and type and relationship identifiers are deterministic.
- Verify the documented low-level no-definition fallback groups only by IFC class and predefined-type intent and creates no reusable document definition.
- Verify one-item parametric, one-item authoritative, multi-item authoritative, generated, and tessellated representations apply the Product appearance to every emitted style target. Verify unstyled Products receive no synthetic style and representation replacement preserves the assignment.
- Verify a Bodyless `IfcElementAssembly` under both unordered aggregation and ordered nesting, with independent role and assembly-location mapping and no synthetic Body.
- Run the same closed tessellated Body through Proxy and Earthworks Fill classifications. Each item reconstructs as `TESSELLATED_MANIFOLD` with matching item count, World bounds, and material volume. An open item remains `TESSELLATED_LOSSY` with an item-specific diagnostic while successful siblings survive.
- Capture backend diagnostics during the BREP-006 representative export and assert no error-level diagnostics on success. A deliberately invalid writer lookup or write returns an actionable typed error. Tests must not mute backend output globally.
- Test IFC4 and IFC4X3 support declarations per handler.

### Facility and Families tests

- Add table-driven spatial-shell fixtures for Building, Bridge, Road, and Railway.
- Test legal and illegal hierarchy, containment, aggregation, nesting, and placement for each applicable kind.
- Keep Bridge end-to-end Product coverage as the first complete facility lane.
- Test that Building accepts rigid placement, preserves grid-relative placement intent, and returns explicit unsupported errors where grid resolution or authoring is not implemented.
- Test that Road and Railway accept rigid placement, preserve alignment-relative placement intent, and return explicit unsupported errors for projection or authoring behavior not yet implemented.
- Test target-independent Families semantics without importing BIM or IFC modules.
- Test that Families resolves ordered occurrence transforms, grid- and alignment-reference intent, and Product-local Body Datum as separate target-independent values.
- Test occurrence metadata and explicit Family definition keys surviving resolution without inference from display name, component identity, archetype, or occurrence path.
- Test a declarative Bodyless Physical Assembly whose children retain classification, occurrence key, metadata, type reference, and placement. Cover unordered aggregation, ordered nesting, missing or duplicate children, self-reference, cycles, and illegal multiple decomposition parents.
- Test corner-, centre-, and rotated-inner-Datum fixtures through authored, eager placed, and IFC-imported World bounds.
- Test a Datum translation inside a rotated Body, not only an outer `tTranslate` chain.
- Test nested rotated spatial ancestors plus a pitched Product through the document World query.
- Before cutover, test that a missing occurrence-transform wrapper fails closed and does not install a centred envelope. At cutover, delete wrapper inspection and prove the explicit placement contract covers the same regressions.
- Test the cutover removes display-name and free-form routing behavior.
- Test that unsupported typed intent never becomes Proxy implicitly.

### Probe tests

- Export and import a direct Member with one Body item.
- Export and import a direct Member with multiple Body items.
- Export and import a Sign.
- Verify Sign text and other authored occurrence metadata through the neutral metadata contract.
- Include Member and Sign under at least two facility kinds.
- Verify that generated curtain-wall members do not become duplicate direct Members on import.
- Review the probe diff. Any edit to Product Body or representation lifetime operations is a failing architecture test even if runtime tests pass.

### Verification and packaging

- Run focused Product Body and placement tests under both supported OCCT backends.
- Run BIM typecheck, lint, coverage, full tests, IFC conformance, and build.
- Run repository boundary, pattern, documentation, playground type-generation, example, and site gates affected by the public cutover.
- Build an npm tarball, install it into a clean temporary consumer, and verify ESM, CJS, declarations, and every public subpath.
- Test the packed artifact rather than relying on workspace source aliases.
- Update downstream bridge regression suites by consuming the packed package. Do not commit temporary dependency changes.

## Package export strategy

Keep one npm package and publish explicit build artifacts for:

- `brepjs-bim` as a small high-level neutral model and authoring entry;
- `brepjs-bim/model` for document records, explicit coordinate-space queries, occurrence identity and metadata, reusable Product types, appearances, assemblies, relationships, positioning references, `PlacementDefinition`, opaque `ResolvedFrame` values and resolver errors, Product classification, Product Body, and representation contracts;
- `brepjs-bim/authoring` for specifications, parsers, geometry builders, and authoring commands;
- `brepjs-bim/ifc` for IFC import, export, runtime setup, IFC-byte validation, schema types, and imported-document contracts;
- `brepjs-bim/families` for the Families adapter;
- `brepjs-bim/cobie`, `brepjs-bim/ids`, and `brepjs-bim/bcf` for the focused standards capabilities.

The root entry must not statically load `web-ifc` or `brepjs-families`. It is not a compatibility facade and does not re-export the old barrel. Raw writer functions, raw reader infrastructure, internal specifications, test hooks, and source-folder paths remain private. IFC import and export share the `/ifc` entry. There is no separate `/import` entry and no broad `/validation` entry that mixes model and IFC validation.

Every export-map entry names matching ESM, CJS, and declaration artifacts. The package build treats `brepjs`, `web-ifc`, and `brepjs-families` according to their declared runtime or peer relationship instead of bundling them accidentally. Public declarations must resolve in a clean consumer without workspace hoisting.

The entrypoint ticket also updates documentation, examples, playground ambient declarations, generated API references, release checks, and all repository imports in the same breaking change. It deletes obsolete aliases instead of forwarding them.

## Non-goals and out of scope

- Moving BIM to another Git repository.
- Splitting the rework into multiple npm packages.
- Preserving the old root barrel or adding compatibility aliases.
- Cherry-picking the `fix/typed-civil-bodies` architecture as the final design.
- Mirroring the complete IFC4.3 schema in the neutral domain.
- Completing all Road and Railway authoring, alignment, referent, or linear-placement behavior. Their facility abstraction and explicit support state are required; full infrastructure authoring is later work.
- Completing a full Building grid authoring system or resolving every grid-reference placement. The neutral variant, positioning-reference records, preservation, validation, and explicit support state are required now.
- Building a general geometric-constraint solver or treating a resolved rigid Frame as a retained parametric-placement program.
- Building a structural-analysis model or conflating physical Member with analytical structural member.
- Treating portal frames, trusses, or spatial lattices as Facilities.
- Creating an open runtime registry for geometry lifetime callbacks. Built-in representation handling remains closed and exhaustive.
- Inferring placement from Body bounds or storing placement inside Product Body.
- Keeping CSG-wrapper inspection as the permanent Families placement contract.
- Executing `semantics.properties.datum` as a transform, or adding a separately authored `bodyDatumOrigin`.
- Treating `fromIfc` loss of `IfcParameterizedProfileDef.Position` as the same defect as a dropped rotated inner Datum. Keep the importer profile-position bug as focused IFC follow-up.
- Fusing Body items for IFC export or import convenience.
- Inventing exact-Body quantities that cannot be derived from retained facts.
- Golden IFC binaries or STEP serialization snapshots.
- Repository-wide owned and borrowed branding for every brepjs handle. This rework enforces ownership through Product Body and document operations.
- Correcting the `ARBITRARY_CLOSED` Beam profile axis and sign mismatch tracked by BREP-012. Keep it as focused authoring-geometry work and do not select authoritative provenance merely to hide the mismatch.
- Adding the exact `IFC4X3_ADD2` schema token tracked by BREP-009. Schema capability declarations remain centralized in the IFC adapter, but the rework requires only supported tokens available when migration begins.
- Adding configurable IFC output length units tracked by BREP-010. The neutral model remains millimetre-based and the IFC adapter owns the existing single conversion; a later unit feature must scale placement, geometry, and quantities together.
- Designing a neutral abstraction for backend-specific mesh-extractor deletion or the prototype's `flatMesh.delete` failure. Foreign-value cleanup stays inside the validated IFC runtime boundary. A focused boundary fix is still in scope when needed to pass the mandatory all-item BREP-013 tests.
- Replacing `web-ifc` or adding another IFC writer backend to resolve BREP-006.
- Unrelated parametric wall quantity defects or overlapping-opening policy unless the new Product Body path directly exposes them.

## Genuine unresolved questions

No unresolved question blocks the Product Body ticket or the migration sequence.

Two package decisions remain intentionally deferred until the entrypoint ticket can test real packed consumers:

1. Whether `web-ifc` becomes an optional peer required only by `/ifc` and `/ids`, or remains a mandatory package-wide peer.
2. Whether `brepjs-families` becomes an optional peer required only by `/families`, or remains a direct dependency externalized from every build artifact.

One future model question remains outside this rework: whether a complete `ImportedBimDocument` should gain an explicit normalization operation that produces a Product-local authored `BimDocument`. The current contract keeps imported geometry World-placed and does not imply that conversion.

## Further Notes

The current codebase provides useful characterization seams: placed-geometry tests, model ownership tests, Families projection tests, IFC import/export integration tests, schema checks, referential-integrity checks, and packed release workflows. The implementation-research branch adds the strongest prior art for authoritative Body takeover, multi-item round trips, exact wall quantities, later-item cleanup, and the two issue #2272 reproductions. Port those behaviors into the new contracts, but do not retain the branch's coupling of provenance to cardinality or its Wall/Railing category dispatch.

The existing architecture already contains several concepts needed by this spec, including assemblies, systems, zones, containment, aggregation, nesting, classification associations, placement frames, and separate import diagnostics. The rework should move and connect those concepts rather than replace them with a second parallel model.

The existing frame helper, composed-placement regression, Families rotation regressions, and temporary resolver-wrapper recovery are implementation evidence for the placement foundation. They are not the target module boundary. Preserve their proven transform and cleanup behavior while moving neutral validation and algebra below the adapters, then delete wrapper-shape dependence at the typed Families cutover.

The [IFC4.3 ADD2 schema](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/IFC4X3_ADD2.exp) defines local, grid, and linear forms as the concrete `IfcObjectPlacement` subtypes. The neutral placement union follows that capability split without copying IFC entities into the domain: `LOCAL_FRAME` is rigid and immediately resolvable, while grid and linear variants retain target-independent references and parameters.

BREP-004, BREP-007, BREP-008, and BREP-011 are required outcomes of the document and adapter seams. BREP-014, BREP-006, BREP-001, and the structural import behavior from BREP-013 are preserved correctness gates inside those tickets. BREP-002 and BREP-003 remain the Member and Sign architecture probes. BREP-012, BREP-009, BREP-010, and backend-specific mesh deletion remain separate focused or deferred work and are not completion gates for the neutral architecture, except where a local adapter cleanup fix is necessary to demonstrate the required BREP-013 behavior.

LOCAL-003, LOCAL-005, LOCAL-006, and LOCAL-008 are downstream acceptance work that should consume packed `brepjs-bim` artifacts after their upstream seams land. LOCAL-007's donor objects and set-out, LOCAL-009's infra-specific Family package interface, and the closed LOCAL items remain outside this architecture rework.
