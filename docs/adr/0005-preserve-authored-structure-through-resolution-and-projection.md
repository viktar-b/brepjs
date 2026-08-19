# Preserve authored structure through resolution and projection

The declarative runtime exposes distinct `family()`, `assembly()`, and `model()` definition primitives. Families own geometry, Assemblies compose keyed Occurrences, and a Model is the single root. TSX children are typed input to components that intentionally accept them, Fragments flatten into their parent, and every definition boundary remains present in the Resolved Model rather than being collapsed into an intrinsic geometry node.

Each resolved node carries its semantic key path, local and composed world Frames, Engineering Semantics, geometry, and children. A validated rigid Frame consists of an origin plus orthogonal `xAxis` and `zAxis`; its remaining axis is derived. Projection reads these frames directly instead of recovering placement by inspecting geometry operations. Existing translation transforms may remain as compatibility API, but new authored models use Frames exclusively.

BIM projection dispatches on Engineering Semantics rather than component display names. Infrastructure projection creates `Project → Site → Bridge → BridgePart → product` without synthesizing Building or Storey containers. It reuses typed Beam, Column, Slab, Wall, Footing, and Railing paths and adds typed Member, Sign, and EarthworksFill paths. Recognized structural objects are never downgraded to building-element proxies.

## Considered options

- Treat Family, Assembly, and Model as folder-only conventions: rejected because the runtime could neither validate their different responsibilities nor preserve them reliably for downstream consumers.
- Flatten component wrappers during resolution: rejected because authored hierarchy and civil spatial structure would be lost before Projection.
- Infer BIM routing from family names: rejected because names are project-owned and may change without changing engineering meaning.
- Recover placement from translated geometry IR: rejected because geometry recipes are not an authoritative placement model and cannot represent general nested rigid Frames safely.
- Use `IfcBuildingElementProxy` for unsupported civil objects: rejected because it discards known product semantics.

## Consequences

The family runtime requires a deliberate breaking extension to its description and resolution contracts. The BIM model and serializer require typed Bridge, BridgePart, Member, Sign, and EarthworksFill support. Product Body serialization uses analytic IFC geometry where supported and otherwise tessellates evaluated authored geometry under the correct typed IFC product class. The previous prototype remains reference evidence only and contributes no runtime code, imported identity, placements, or tessellation to the authored project.
