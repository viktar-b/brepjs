# Infra Bridge reconstruction report

## Outcome

The accepted engineering scope is reconstructed as a clean declarative model: one road-girder bridge plus two keyed Occurrences of one parameterized rail-arch bridge definition. The resolved and exported model contains exactly 3 Bridges, 18 BridgeParts, and 47 typed products. All 47 pass the applicable quantitative geometry, placement, volume, material, class, containment, stable-identity, validation, and reimport checks. The visible sign lettering uses the public text-to-BRep path and a bundled project font. Human visual approval remains pending and is not counted as passed.

This is not a claim of byte-for-byte or whole-file semantic identity. The Reference IFC also contains three explicitly unscoped placed objects, three extra Site shells, a projected CRS/map conversion, and source identities. Those distinctions are reported independently below.

## Source inventory

The public Reference Harness reports:

| Evidence                          | Source observation                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema                            | `IFC4X3_ADD2`                                                                                                                                                         |
| Length unit                       | 1 source unit = 1 mm                                                                                                                                                  |
| Spatial structure                 | 1 Project, 6 Sites, 3 Bridges, 18 BridgeParts                                                                                                                         |
| Scoped products                   | 47: 8 Beams, 7 Columns, 4 EarthworksFills, 7 Footings, 8 Members, 2 Railings, 4 Signs, 3 Slabs, 4 Walls                                                               |
| Unscoped placed objects           | 1 georeference `IfcBuildingElementProxy`; 2 highway-marker `IfcElementAssembly` objects                                                                               |
| Representations                   | 54 `IfcTriangulatedFaceSet` plus 54 `IfcCartesianPointList3D`; the 47 mapped products expose 77 Body face-set items because railings and signs have multi-item Bodies |
| Placements                        | 77 `IfcLocalPlacement` entities; selected product world Frames are retained separately from component-local targets                                                   |
| Materials                         | 7 source materials; the 47 scoped products use 6 (soil 4, in-situ concrete 9, prefab concrete 2, copper 4, granite masonry 19, timber 9)                              |
| Scoped world bounds               | X 7,560.254–44,401.270 mm; Y 24,746.849–56,905.256 mm; Z −3,500.000–7,774.582 mm                                                                                      |
| Repetition                        | 9 shared-representation groups, including repeated rail fills, arches, spandrels, rail piers, road outer piers, and main girders                                      |
| Alignment, bearing, reinforcement | No `IfcAlignment`, bearing, or reinforcement occurrences are present in this file                                                                                     |

The complete entity-count map, flattened product evidence, Frames, hierarchy, target bounds, dimensions, volumes, and repetition groups are generated at `reference/infra-bridge/tmp/inventoryReport.json`.

## Reconstruction specification

All authored dimensions are millimetres. Every Family uses +X longitudinal, +Y transverse, and +Z upward around a named engineering Datum.

### Road-girder bridge

The road bridge has five major BridgeParts: substructure, superstructure, deck, and two approaches. The substructure contains three explicit pier BridgeParts; each pier contains one 4,000 × 300 × 400 cross girder, one 3,600 × 550 × 2,286.321 pier stem, and one 5,000 × 2,100 × 700 footing. The superstructure contains three explicit 9,891 × 250 × 300 main girders. The deck contains one 9,909 × 3,368 × 56 slab and two 9,909 mm procedural post-and-rail guardrails. Each approach contains a 2,435.296 × 3,600 × 200 slab at 5.710593° and a nested abutment with a 3,600 × 195 five-point bearing-seat beam.

The road Site set-out is origin `[17320.508, 30000, 0]` at 120°; the Bridge Datum is `[0, 0, 242.321]` at −90° relative to the Site.

### Rail-arch bridge

One `RailArchBridge` definition is instantiated at `[17320.508, 50000, 0]` and `[34641.016, 40000, 0]`, both at 60°. Each bridge has a superstructure and a substructure. Each superstructure contains two 10,000 × 3,500 fills with a 4,084.236 rise; four quarter arch bands with outer run/rise 5,000/4,084.236, inner run/rise 4,250/3,333.333, 750 band thickness, and 3,500 width; two 20,000 × 450 × 4,484.236 two-bay spandrel walls; and two 1,600 × 50 × 400 backed signs. Each substructure contains two pier BridgeParts, each with a 1,500 × 4,400 × 3,780.346 stem and a 6,400 × 3,500 × 1,000 footing.

The arch crown is a six-segment cubic profile with named horizontal/vertical controls 0.548/0.566; the inner opening is elliptical. The sign backing dimensions are exact, while its visible project block lettering is a visual approximation of the unidentified reference font.

## Architecture and fallbacks

The product path is `brepjs-families TSX → CSG IR → resolve/evaluate → infrastructure Projection → BimModel → IFC4X3`. The Reference Harness independently performs `checksummed IFC → complete representation decoder → component-local ReconstructionTarget + scene Frame → physical-unit scoring`.

There is one direct `BimModel` fallback module, but its runtime scope is the complete model. `familiesToBim()` rejects nested `BridgePart → BridgePart`, which the road approaches and both bridge substructures require, and it returns no usable partial projection. Consequently zero full-model Occurrences use the preferred adapter: `projectInfraBridge()` creates every spatial node, product, Body, material relationship, and containment relationship through public BimModel methods so the hierarchy is not flattened. It still dispatches only on definition-owned Engineering Semantics, consumes resolved Frames, uses stable Semantic Key paths, and tessellates evaluated authored geometry. A non-nested synthetic parity test protects the fallback against the public adapter. There are no reference-driven BimModel calls.

The sign uses no BimModel geometry fallback. Its bundled owned OpenType font is registered with `loadFont()`; `textBlueprints()` produces glyph outlines, `blueprintToContour()` converts them to owned Profile IR, and `csg.profile()`/`csg.extrude()` creates the visible relief inside the TSX Family.

## Independent fidelity gates

| Gate                                 |                                        Threshold |                               Measured result | Status                 |
| ------------------------------------ | -----------------------------------------------: | --------------------------------------------: | ---------------------- |
| Scoped hierarchy                     |         3 Bridges / 18 BridgeParts / 47 products |                                   3 / 18 / 47 | Pass                   |
| Product class, containment, material |       Exact source versus reimport for every key |                          47/47 per-key matrix | Pass                   |
| Generated GlobalIds                  |            Deterministic from Semantic Key paths |         Two independent projections identical | Pass                   |
| Simple dimensions/envelopes          |                                           ≤ 2 mm |      worst product envelope delta 0.002625 mm | Pass                   |
| Control-point placement              |                                           ≤ 5 mm |                worst origin delta 0.000401 mm | Pass                   |
| Frame orientation                    |                             project gate ≤ 0.01° |          worst X-axis delta 0.00000121°; Z 0° | Pass                   |
| Whole-bridge envelope                |                                 ≤ 10 mm per face |                        worst face 0.001925 mm | Pass                   |
| Comparable volumes                   |                                             ≤ 2% |                   worst relative error 0.319% | Pass                   |
| Curved surface distance              |                         p95 ≤ 25 mm; max ≤ 75 mm |                    p95 7.995 mm; max 9.757 mm | Pass                   |
| Curved normal agreement              | reported independently; project gate mean ≥ 0.99 |                    worst mean cosine 0.998552 | Pass                   |
| IFC validation                       |                           zero structured errors |                                   zero errors | Pass                   |
| IFC reimport                         |                        successful, typed 3/18/47 |                                    successful | Pass                   |
| Text-to-BRep sign                    |             public font-outline declarative path | bundled OpenType → Profile IR → raised relief | Pass                   |
| Visual artifacts                     |         separate isometric, plan, elevation, GLB | generated under `examples/infra-bridge/dist/` | Pending human approval |

Supporting IoU is reported but is not used to conceal or replace the normative gates. The minimum 32³ voxel IoU is 0.8879 on the thin raised sign lettering; thin disconnected railing members also make coarse voxel IoU less diagnostic than the exact envelope/surface/volume checks.

The writer's final IFC and structured validator are green, and the IFC reimports without diagnostic errors. During export, web-ifc 0.0.77 still prints two `GetLineType()` messages for Express ID 11 while resolving the geometric representation context; the final file contains valid `#11` and reimports correctly. This console-only diagnostic is retained as a writer integration limitation, not counted as a hidden validation success.

## Gap matrix

This analysis applies deep-module ownership: authored Families express engineering intent; Projection owns IFC routing/identity/relationships; the Reference Harness owns source evidence.

| Source requirement                                         | Attempted current API                                                                    | Achieved result                                                                                                                  | Workaround used                                                                     | Missing capability and owning layer                                              | Severity         | Proposed API improvement                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Nested substructure/pier and approach/abutment BridgeParts | `familiesToBim(root, { evaluatedModel })`                                                | Exact 18-part aggregation and product containment                                                                                | Whole-model public `BimModel` projector; zero Occurrences use the preferred adapter | Recursive civil spatial routing in Projection                                    | High             | Permit `BridgePart` under `BridgePart`, retain the stable-key result map, and test recursive aggregation through `familiesToBim()` |
| Font-outline bridge signs                                  | `loadFont()` → `textBlueprints()` → `blueprintToContour()` → `csg.profile()`/`extrude()` | Exact plate and readable raised `BREPJS`; the committed font asset and resulting Profile IR are reference-independent            | None; current public APIs compose directly                                          | No missing capability for the required supported glyph set                       | Resolved         | A serializable `csg.text()` node could shorten this composition, but is not required for fidelity                                  |
| Full source Site shell                                     | Site semantics and resolved Frames                                                       | Three bridge Sites and every Bridge/BridgePart placement are exact; environmental root plus road/parking empty Sites are omitted | None; omitted by accepted scope                                                     | Recursive `Site → Site` civil aggregation in Projection                          | Medium           | Support nested Site semantics independently from bridge geometry and accept site-shell configuration at Projection                 |
| Projected CRS/map conversion                               | Existing `ProjectSpec.crs` on direct BimModel                                            | World set-outs are exact, but source CRS metadata is not authored or round-tripped                                               | None; reference-derived CRS is kept out of product source                           | Reference-independent georeferencing configuration seam around Projection/export | Medium           | Let the export caller provide `ProjectCrs` without embedding reference evidence in Families                                        |
| Semantic Key round-trip                                    | Stable keys seed generated IFC GlobalIds                                                 | Deterministic identity survives repeat export; the human Semantic Key does not survive IFC reimport                              | Test-side key-to-LocalId map                                                        | Persistent source-neutral occurrence identity in Projection/import               | Medium           | Serialize a namespaced identity property/external reference and expose it on `ImportedElement`/spatial nodes                       |
| Source GlobalIds                                           | Stable Semantic Keys and generated GlobalIds                                             | Source IDs intentionally not preserved                                                                                           | None                                                                                | This is an ADR-level non-goal, not an accidental API gap                         | Intentional      | Keep generated identity as default; any opt-in import-preservation mode must remain outside authored Family props                  |
| Analytic/swept IFC meaning                                 | Authored CSG profiles plus typed tessellated ProductBody                                 | Parametric intent remains in TSX, but export emits typed tessellated Bodies                                                      | Evaluated authored tessellation                                                     | Proven analytic ProductBody descriptors for non-box profiles in Projection       | Medium           | Add datum-aware extruded/swept/curved ProductBody descriptors and reimport their exact parameters                                  |
| Source highway-marker assemblies                           | Existing TSX Assemblies and BimModel assembly support                                    | Authored bridge Assemblies survive resolution; two source highway-marker assemblies are omitted                                  | None; explicitly unscoped                                                           | Civil assembly semantic route if those objects enter scope                       | Low/out of scope | Add a target-independent assembly semantic kind routed to `IfcElementAssembly` without name dispatch                               |
| Source georeference proxy                                  | Typed civil routes deliberately reject proxy fallback                                    | No structural product becomes a proxy; the source's one virtual-black georeference proxy is omitted                              | None; explicitly unscoped                                                           | No missing structural capability                                                 | Low/out of scope | Represent georeferencing through CRS/map conversion, not a proxy product                                                           |
| Alignment, bearings, reinforcement                         | Inventory through the Reference Harness                                                  | No such occurrences exist in this Reference IFC                                                                                  | None                                                                                | Not applicable to this file                                                      | N/A              | Add typed semantics/routes only when a real capability profile requires them                                                       |
| Clean IFC validation output                                | `toIfcValidated()` and `fromIfc()`                                                       | Zero structured errors and successful reimport                                                                                   | None                                                                                | web-ifc writer/validator dependency-order console diagnostic                     | Low              | Resolve representation-context references after entity registration or capture/deduplicate this known diagnostic                   |

## Prototype retirement audit

The Reference Harness now owns every forensic capability used by this reconstruction: checksummed manifest selection, IFC schema/unit/material/hierarchy inventory, tessellated/parametric/analytic-BRep decoding, placement composition, repetition evidence, component-local targets, physical-unit scoring, source-vs-reimport semantic comparison, and generated reports. The authored model, preview, tests, and IFC export do not import the harness or the rejected prototype. Therefore `tmp/infra-bridge-prototype` is no longer needed for forensic capability or reproduction. It remains untouched because deletion requires separate explicit authorization.

## Reproduction

From the repository root:

```sh
npm install
npm -C examples/infra-bridge run check
npm -C examples/infra-bridge run preview
npm -C examples/infra-bridge run export:ifc
npm run check:infra-bridge-reference
npm -C reference/infra-bridge run report:inventory -- --ifc tmp/Infra-Bridge.ifc
npm -C reference/infra-bridge run compare:model -- --ifc tmp/Infra-Bridge.ifc
```

The highest-fidelity exchange artifact is `examples/infra-bridge/dist/infra-bridge.ifc`; the GLB and SVG files are visual sidecars. The committed product is the TSX model, not any generated artifact.

## Plain conclusion

The accepted 47-product bridge scope is reconstructed at 100% count/relationship coverage and all automated fidelity gates pass, including the required text-to-BRep lettering. Human visual approval is still pending. Relative to every placed nonspatial object in the original file, coverage is 47/50 = 94% because the intentionally unscoped georeference proxy and two highway-marker assemblies are absent. Bridge and BridgePart hierarchy is 100%; the broader Site shell is simplified from 6 source Sites to 3 authored bridge Sites.

Geometry is high fidelity, not vertex identity. Simple structural products are effectively exact at the measured tolerances; curved rail profiles are authored approximations with p95 under 8 mm and mean normal cosine above 0.9985. The sign backing is exact, but the glyph shapes are only a visual block-font approximation. Source GlobalIds, environmental/parking Sites, CRS metadata, the proxy, and highway-marker assemblies are not round-tripped.

The smallest API addition that removes the only full-model authoring fallback is recursive civil spatial routing in `familiesToBim()`. An export seam for CRS plus persistent Semantic Keys would close the broader round-trip gaps. Datum-aware analytic ProductBody descriptors would then preserve more authored curve/sweep meaning in IFC instead of tessellating it.
