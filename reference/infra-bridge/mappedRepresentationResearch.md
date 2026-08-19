# IFC mapped representation notes

## Decision

Decode `IfcMappedItem` as a complete occurrence wrapper, not as authored identity or as a
standalone target. Resolve its `IfcRepresentationMap.MappedRepresentation` to one complete
representation item, decode that item through the existing Adapter dispatch, and then transform
the source-local observation by:

```text
MappingTarget × inverse(MappingOrigin)
```

Use the representation-map identity only internally to group source-neutral repetition evidence.
Do not expose its Express ID or IFC type through the Reference Harness.

The transform operator supplies the local origin, orthogonal axes, and uniform scale; the
non-uniform subtype supplies independent Y and Z scales. A negative linear determinant reverses
orientation, so decoded comparison triangles must be flipped. Points use the affine transform,
lines use its linear part, and plane normals use inverse-transpose.

## Scope

- Nested mapped items may be resolved recursively, with cycle detection.
- A representation map with multiple complete items remains unsupported by the current
  single-target vertical slice.
- Non-uniform mapping is valid for tessellated geometry. It is rejected when it would make named
  parametric dimensions or circular analytic evidence misleading.

## Primary sources

- [IfcMappedItem](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcMappedItem.htm)
- [IfcRepresentationMap](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcRepresentationMap.htm)
- [IfcCartesianTransformationOperator3D](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcCartesianTransformationOperator3D.htm)
- [buildingSMART mapped-shape transformation example](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/annex_e/mapped-geometric-shape/mapped-shape-with-transformation.html)
