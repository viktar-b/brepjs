# Author bridge families in engineering coordinates

The bridge project begins with project-local Families for its structural leaves and Assemblies for its meaningful compositions. Initial Families are `AbutmentCapBeam`, `ApproachSlab`, `ArchRib`, `BridgeDeck`, `BridgeRailing`, `BridgeSign`, `CrossGirder`, `EarthFill`, `Footing`, `MainGirder`, `PierStem`, and `SpandrelWall`. Initial Assemblies are `RailArchSuperstructure`, `RailArchBridge`, `RailPier`, `RoadAbutment`, `RoadGirderBridge`, and `RoadPier`.

All authored dimensions use millimetres. Every Family documents a Datum in a consistent local engineering frame where `+X` is longitudinal, `+Y` is transverse, and `+Z` is upward. Component dimensions are typed props or named constants beside their definition; span-wide dimensions and placement rules belong to the Assembly that coordinates them. Georeferencing is Projection configuration rather than geometry baked into components.

Families declare Engineering Semantics rather than IFC entities. Target Projection maps structural role, material, and authored properties onto IFC classes, hierarchy, relationships, and materials. Families remain local until a second independent model demonstrates a reusable contract suitable for the copy-in registry.

## Considered options

- Publish the first bridge components directly to the registry: rejected because one reconstruction is not enough evidence for a stable reusable interface.
- Put calibrated dimensions in one central data or inventory file: rejected because it separates dimensions from the engineering definitions that give them meaning.
- Add a generalized inheritance or slot system: rejected because typed props, composition, and deliberate copy-and-own adaptation cover the known variation with less hidden behavior.
- Use reference-derived tessellation for difficult structural shapes: rejected because it would preserve appearance while discarding authored geometry and engineering intent.
- Bake projected coordinates into every component: rejected because large world coordinates harm readability, reuse, and numerical clarity.

## Consequences

Major structural geometry must be expressed with authored profiles and operations. An Owned Asset is allowed only for a genuinely non-parametric decorative shape and must be documented explicitly. Family tests cover dimensions, topology, Datum, and geometry validity; Assembly tests cover semantic key paths, occurrence counts, and frame composition; Projection and reference-comparison tests remain separate.
