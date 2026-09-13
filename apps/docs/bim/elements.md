---
title: Element Catalog
description: 'Every parametric element brepjs-bim authors: structural, spatial, openings, and the profile vocabulary they extrude.'
---

# Element Catalog

Every element has a typed, validated spec in millimeters. Parametric physical elements build analytical brepjs solids in local coordinates; civil spatial elements are body-less, and Earthworks Fill accepts an arbitrary validated body. Placement is applied downstream via `IfcLocalPlacement`.

| Element         | Method                   | Notes                                                                                |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| Wall            | `addWall`                | Length along `axisX`, openings cut via `addDoor` / `addWindow`                       |
| Slab            | `addSlab`                | `FLOOR` / `ROOF` / `LANDING` / `BASESLAB`; slab openings via `parseSlabOpeningInput` |
| Beam            | `addBeam`                | Profile extruded along `axisX` by length                                             |
| Column          | `addColumn`              | Profile extruded along `axisZ` by height                                             |
| Roof            | `addRoof`                | Flat slab, or shaped (shed / gable / hip / dome) when `pitch` is present             |
| Curtain wall    | `addCurtainWall`         | Panel and mullion grid                                                               |
| Space           | `addSpace`               | Room volumes for zoning and COBie                                                    |
| Footing / pile  | `addFooting` / `addPile` | Foundations                                                                          |
| Stair           | `addStair`               | One or more flights, each a stepped sawtooth solid with its own placement            |
| Ramp            | `addRamp`                | Flights like stairs, inclined slabs                                                  |
| Railing         | `addRailing`             | Posts + rails with `infill: 'POSTED'`, or a single swept panel                       |
| Covering        | `addCovering`            | Finishes: flooring, cladding, ceilings                                               |
| Bridge          | `addBridge`              | IFC4X3 spatial facility; no independent Body                                         |
| Bridge part     | `addBridgePart`          | IFC4X3 recursive spatial part with mandatory usage type                              |
| Earthworks fill | `addEarthworksFill`      | IFC4X3 typed arbitrary Product Body, material, and spatial containment               |
| Proxy           | `addProxy`               | Anything else, carrying arbitrary brepjs geometry                                    |

Doors and windows are not free-standing: `addDoor` / `addWindow` take a host wall, cut the opening as a boolean void, and wire `IfcRelVoidsElement` + `IfcRelFillsElement`.

## Profiles

Beams and columns extrude a **profile**, one vocabulary shared by both:

- Core: `RECTANGULAR`, `CIRCULAR`, `I_BEAM` (with optional root `filletRadius`)
- Extended: L / T / U / Z / C shapes, asymmetric I, ellipse, trapezium, hollow rectangular and circular sections, and arbitrary polygons with voids

Every **named** profile emits its own parametric IFC profile def, extended kinds included: `IfcRectangleProfileDef` / `IfcCircleProfileDef` / `IfcIShapeProfileDef` for the core three, and `IfcLShapeProfileDef`, `IfcTShapeProfileDef`, `IfcUShapeProfileDef`, `IfcZShapeProfileDef`, `IfcCShapeProfileDef`, `IfcAsymmetricIShapeProfileDef`, `IfcEllipseProfileDef`, `IfcTrapeziumProfileDef`, `IfcRectangleHollowProfileDef` and `IfcCircleHollowProfileDef` for the rest. The section stays editable parametric data in the exported file rather than a baked outline.

Only the two point-list kinds serialize as outlines, which is inherent to what they are: `ARBITRARY_CLOSED` becomes `IfcArbitraryClosedProfileDef` and `ARBITRARY_WITH_VOIDS` becomes `IfcArbitraryProfileDefWithVoids`.

On the brepjs side, `extendedProfileToFace` builds the section face for the solid and `extendedProfileArea` gives closed-form areas for takeoff.

## Shaped roofs

`pitch` opts a roof into shaped geometry for its `predefinedType`: a right-trapezoid prism (shed), a house-pentagon prism (gable), a convex-hull hip with the ridge along the longer side, or a faceted dome. Without `pitch` the roof is a flat slab whatever the type says. Shaped roofs, walls, and railings serialize retained geometry as tessellated Bodies. Other supported recipe writers can use `IfcExtrudedAreaSolid`.

## Placement and display

Element geometry is **unplaced template geometry**. A generated wall starts at the local origin and runs along local +X; `origin` / `axisX` / `axisZ` live in the spec and become `IfcLocalPlacement`. Wall and railing `.geometry` is a `ProductBody` with nonempty `items` under both `PARAMETRIC` and `AUTHORITATIVE` authorities. `bodySolids()` borrows those local handles. Do not dispose them; clone any item you need to retain independently.

Use `takeProductBody()` to explicitly replace a Wall or Railing Body and request its authority. Success transfers every supplied solid and protects the stored collection. Failure leaves the model and caller ownership unchanged. Inputs must be exclusively caller-owned. The model rejects duplicates and handles it already owns. Register wall openings before authoritative adoption. Later `addDoor()` and `addWindow()` calls on AUTHORITATIVE walls return `AUTHORITATIVE_WALL_BODY_IMMUTABLE`.

`familiesToBim()` copies and adopts authored civil-semantic Wall and Railing Bodies when given `bodyEvaluator` or `proxyEvaluator`. Those routes require an evaluator; missing it returns `FAMILIES_PRODUCT_BODY_EVALUATOR_REQUIRED`. Registered openings are applied before adoption. Every authored item remains AUTHORITATIVE even when a recipe would produce coincident geometry. Conventional archetype walls and railings continue to use recipe authoring. IFC export serializes retained Body items as tessellation under both authorities. `measureProductBodyVolume()` returns occupied-union volume in mm³ as a `Result` without changing item count or order.

`placedSolids(element)` returns fresh, caller-owned solids transformed by the element's own placement. For an element beneath a placed spatial structure, pass its cumulative frame as `placedSolids(element, { parentFrame })` to obtain world coordinates for display or clash checks. ProductBodies return one placed copy per Body item. Stairs and ramps return one per flight, and curtain walls return their panels and mullions. Elements that are purely relational (doors, windows, groups, spatial containers) return an empty list rather than an error.

## Data layers

Beyond geometry, elements carry: property sets from IFC pset templates with typed measures, quantity sets for takeoff, materials (simple, layer sets, profile sets), classification references (Uniclass, OmniClass, and friends), surface styles, and zone / system membership. Stable identity comes from deterministic GUIDs: `deriveIfcGuid` for content-derived ids, `newIfcGuid` for random ones.
