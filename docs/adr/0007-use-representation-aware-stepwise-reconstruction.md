# Use representation-aware stepwise reconstruction

Reverse engineering begins by decoding the complete source representation item rather than treating `IfcCartesianPointList3D` as independently meaningful geometry. IFC tessellated face sets combine their ordered coordinates with face indices, optional point indirection, closedness, units, and placements; parametric IFC solids and analytic B-Reps retain richer evidence and must not be reduced prematurely to the same mesh-only input.

Representation Decoders therefore follow separate lanes for parametric IFC geometry, tessellated or polygonal IFC geometry, and analytic B-Rep geometry. Each lane produces a component-local Reconstruction Target with a comparison surface and the strongest additional evidence available. Parametric IFC geometry may translate deterministically; tessellation requires inference from indexed surfaces; analytic B-Rep reconstruction additionally uses surface types, curves, edges, adjacency, and exact parameters.

All inferred geometry uses a brepjs-native stepwise loop inspired by CADENA: propose an authored operation, execute the partial program, compare its geometry with the Reconstruction Target, and continue from an improving candidate. The architecture adopts the execute-and-compare method, not CADENA's CadQuery DSL, normalised coordinate system, fixed-view observation protocol, trained weights, or single-mechanical-part assumptions. Comparison remains in physical millimetres and may revise an early Datum or Frame choice.

Bridge reconstruction is layered. Scene recovery deterministically extracts Bridge and BridgePart hierarchy, products, materials, placements, and repeated-shape candidates. Family recovery reconstructs each distinct leaf in local coordinates. Assembly authoring explicitly composes approved Families with Semantic Keys and Local Frames. A reconstruction loop never emits the complete IFC scene as one program.

## Considered options

- Dispatch on `IfcCartesianPointList3D`: rejected because a coordinate list contains neither face topology nor enough context to determine its geometric meaning.
- Convert every source to a normalized mesh: rejected because it destroys exact analytic evidence available in parametric IFC representations and B-Reps.
- Integrate CADENA's model and CadQuery DSL as the required reconstruction engine: rejected because its operation language, coordinate normalization, observation protocol, and training domain do not match brepjs civil authoring.
- Reconstruct the entire bridge scene in one optimization loop: rejected because spatial hierarchy, repetition, and assembly placement are different problems from leaf geometry recovery.
- Commit generated component code directly: rejected because geometric similarity does not guarantee readable dimensions, a correct Datum, appropriate semantics, or clean authorship.

## Consequences

The Reference Harness requires Representation Decoders and a common Reconstruction Target contract. Mesh comparison includes physical-unit surface distance and normal agreement inspired by GMS, with volumetric IoU used only for closed solids. Analytic B-Rep targets additionally compare topology and surface types. The reconstruction engine may produce a Candidate Family, but the candidate enters `examples/infra-bridge/` only after an authoring gate confirms named dimensions, a documented Datum, readable brepjs operations, Engineering Semantics, absence of reference vertices and identities, and all applicable invariant and Fidelity Gates.

## References

- [CADENA: Stepwise CAD Reverse Engineering](https://arxiv.org/html/2608.00799)
- [IfcTriangulatedFaceSet — IFC 4.3.2](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcTriangulatedFaceSet.htm)
