# IFC4.3 analytic B-Rep decoder: smallest correct lane

## Recommendation

Implement the first analytic lane as one complete `IfcAdvancedBrep` containing a
closed, planar rectangular solid. Dispatch only when the complete Body item is
`IfcAdvancedBrep`; never treat a face, loop, edge, surface, or point as an
independent reconstruction target. A valid Body representation declares
`RepresentationIdentifier = 'Body'` and `RepresentationType = 'AdvancedBrep'`.
[buildingSMART: Body AdvancedBrep Geometry](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/concepts/Product_Shape/Product_Geometric_Representation/Body_Geometry/Body_AdvancedBrep_Geometry/content.html)

This is the smallest lane that preserves analytic meaning without depending on a
generic tessellator:

- one `IfcAdvancedBrep`;
- one `IfcClosedShell`;
- six `IfcAdvancedFace` instances backed by `IfcPlane`;
- one `IfcFaceOuterBound` and `IfcEdgeLoop` per face;
- twelve shared `IfcEdgeCurve` instances backed by `IfcLine`;
- eight shared `IfcVertexPoint` instances backed by 3D `IfcCartesianPoint`;
- two oriented uses of every edge, one in each direction.

The expected source-neutral result is a closed comparison surface with 8 unique
vertices and 12 outward triangles plus analytic evidence for 6 planes, 12 lines,
and topology `{ vertexCount: 8, edgeCount: 12, faceCount: 6, closed: true }`.
Envelope dimensions may be emitted as named observations, but they are derived
evidence rather than IFC parameters.

`IfcAdvancedBrep` is explicitly a solid with all faces, edges, and vertices
represented, and its `Outer` is an `IfcClosedShell` whose normals point away from
the solid. Every shell face must be an `IfcAdvancedFace`.
[IfcAdvancedBrep](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcAdvancedBrep.htm)
[IfcManifoldSolidBrep](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcManifoldSolidBrep.htm)

## Required traversal

Traverse handles in this order, resolving each reference in the Reference
Harness implementation:

```text
IfcProduct
  -> Representation (IfcProductDefinitionShape)
  -> Representations (Body IfcShapeRepresentation)
  -> Items (complete IfcAdvancedBrep)
  -> Outer (IfcClosedShell)
  -> CfsFaces (IfcAdvancedFace[])
  -> Bounds (IfcFaceOuterBound/IfcFaceBound[])
  -> Bound (IfcEdgeLoop)
  -> EdgeList (IfcOrientedEdge[])
  -> EdgeElement (IfcEdgeCurve)
  -> EdgeStart/EdgeEnd (IfcVertexPoint -> IfcCartesianPoint)
  -> EdgeGeometry (IfcLine; later IfcCircle)
  -> FaceSurface (IfcPlane; later IfcCylindricalSurface)
```

The schema requires advanced faces to use an elementary, swept, or B-spline
surface; edge-loop edges must be `IfcEdgeCurve`, and their geometry is restricted
to line, conic, polyline, or B-spline curve families.
[IfcAdvancedFace](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcAdvancedFace.htm)

An `IfcClosedShell` is a connected, closed, oriented 2-manifold. In particular,
every edge is referenced exactly twice, oriented-edge uses are unique, and faces
may meet only at shared boundaries.
[IfcClosedShell](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcClosedShell.htm)

## Orientation rules that the decoder must apply

There are three independent flags; none may be ignored:

1. `IfcEdgeCurve.SameSense` says whether increasing curve parameter agrees with
   `EdgeStart -> EdgeEnd`. Vertices trim the otherwise unbounded curve.
   [IfcEdgeCurve](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcEdgeCurve.htm)
2. `IfcOrientedEdge.Orientation` says whether this use follows the edge element's
   start-to-end direction. The same edge is normally used twice, once forward and
   once backward.
   [IfcOrientedEdge](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcOrientedEdge.htm)
3. `IfcFaceBound.Orientation = false` reverses the loop and all its oriented-edge
   senses when the loop bounds that face.
   [IfcFaceOuterBound](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcFaceOuterBound.htm)

The final loop traversal defines the topological face normal. Counter-clockwise
edges, viewed along the outward normal, point outward. `IfcAdvancedFace.SameSense`
does not define that topology; it declares whether the underlying analytic
surface normal agrees with the topological face normal. Use it to orient retained
analytic evidence and validate consistency.
[IfcFace](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcFace.htm)

For the planar slice, `IfcPlane.Position.P[3]` is the plane normal. Triangulate
the already oriented planar outer loop deterministically and keep its winding in
the comparison surface. Reject non-planar, self-intersecting, degenerate, or
unsupported holed faces rather than guessing.
[IfcPlane](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcPlane.htm)

`IfcLine` is unbounded and has positive direction `Pnt + u * Dir`; the edge's two
vertices provide its finite trim. Scale the point and vector magnitude as
lengths, normalize only the retained line direction, and apply
`IfcEdgeCurve.SameSense` to its sign.
[IfcLine](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcLine.htm)

## Frames and physical units

Keep B-Rep geometry in the product/component-local target. Surface and curve
placements are local analytic geometry and must be applied there. Product
`IfcLocalPlacement` remains separate scene evidence and is composed through
`PlacementRelTo`; a placement without a parent is absolute.
[IfcLocalPlacement](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcLocalPlacement.htm)

For every `IfcAxis2Placement3D`, `Axis` defines Z, `RefDirection` approximates X,
and Y is derived. Missing axes use the global defaults. Reject zero or parallel
directions; do not preserve a non-rigid/skew frame.
[IfcAxis2Placement3D](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcAxis2Placement3D.htm)

Convert all Cartesian coordinates, placement origins, radii, and vector
magnitudes from the project length unit to millimetres. Direction ratios and
Boolean orientation flags are dimensionless. `IfcSIUnit.Prefix` defines the SI
decimal scale, so the synthetic fixture should deliberately use metres (or
centimetres) to prove the conversion rather than authoring millimetres only.
[IfcSIUnit](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcSIUnit.htm)

## Cylinder and circle boundary

The source-neutral contracts can retain cylinders and circles, but they should
not be claimed as supported by the first box slice. `IfcCylindricalSurface`
defines its axis by placement Z, its radius in project length units, and a normal
pointing away from the axis.
[IfcCylindricalSurface](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcCylindricalSurface.htm)

Correct cylindrical faces also require deterministic handling of periodic seams,
circle trimming, and sometimes `IfcSeamCurve`/p-curves. `IfcCircle` has a placed
parameterization over `[0, 2π]`; endpoint vertices and sense flags determine the
edge traversal.
[IfcCircle](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcCircle.htm)

Therefore add cylinder/circle only as a focused second slice. Until then, return
`UNSUPPORTED_REPRESENTATION` for a cylindrical face or circular edge. Never emit
partial planar caps while silently dropping the curved face.

## Structured rejection matrix

| Condition                                                                                                                                          | Error                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Body item is not exactly a supported complete `IfcAdvancedBrep`                                                                                    | `UNSUPPORTED_REPRESENTATION` |
| `IfcAdvancedBrepWithVoids` before inner-shell support                                                                                              | `UNSUPPORTED_REPRESENTATION` |
| Unsupported surface (initially cylinder, cone, sphere, torus, swept, B-spline)                                                                     | `UNSUPPORTED_REPRESENTATION` |
| Unsupported curve (initially circle, ellipse, polyline, B-spline, surface/seam curve)                                                              | `UNSUPPORTED_REPRESENTATION` |
| Non-edge loop, inner/holed bound, or periodic face not implemented                                                                                 | `UNSUPPORTED_REPRESENTATION` |
| Missing/unsupported project length unit                                                                                                            | `UNIT_FAILURE`               |
| Cyclic, non-3D, zero-axis, or otherwise invalid placement                                                                                          | `PLACEMENT_FAILURE`          |
| Missing face/edge/vertex reference, loop gap, duplicate use, degenerate edge/face, inconsistent surface/vertex geometry, or non-manifold incidence | `INVALID_TOPOLOGY`           |
| An edge is not used exactly twice, or the shell/comparison mesh is not closed                                                                      | `OPEN_TOPOLOGY`              |

The public `loadReference()` boundary must catch unexpected reader/runtime
failures and translate them to a `ReferenceHarnessError`; no raw web-ifc object,
Express ID, exception, or representation-specific field should cross that seam.

## Synthetic acceptance fixture

Use one named/material-bearing product selected by the existing checksummed
semantic-key manifest. Give it a nested rotated/translated product placement and
a non-millimetre project unit. Its Body contains the planar advanced B-Rep box
above, with at least one reversed `IfcOrientedEdge`, one false face-bound
orientation, and one false face `SameSense` while remaining geometrically
consistent. Public-interface assertions should prove:

- exact local millimetre vertices, outward triangles, bounds, and closedness;
- exact composed scene frame, kept out of local target vertices;
- 6 plane, 12 line, and `8/12/6/closed` analytic/topological evidence;
- malformed open shell and orientation/topology cases return structured errors;
- a bare advanced face, shell, loop, edge, or point is not accepted as geometry;
- the tessellated, parametric, and analytic products all load through the same
  `loadReference()` interface with no decoder mode flag or source-type leakage.

The official buildingSMART cube example confirms the containing pattern
`IfcAdvancedBrep -> IfcClosedShell -> IfcAdvancedFace -> IfcFaceOuterBound ->
IfcEdgeLoop -> IfcOrientedEdge -> IfcEdgeCurve`, followed by a Body
`IfcShapeRepresentation` of type `AdvancedBrep`.
[buildingSMART Cube Advanced Brep example](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/annex_e/advanced-geometric-shape/cube-advanced-brep.html)
