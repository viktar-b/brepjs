# Structure the bridge as owned components

The authored bridge is a committed private example project at `examples/infra-bridge/`. It owns one primary reusable Family or Assembly per TSX file, with leaf engineering definitions under `src/families/`, reusable compositions under `src/assemblies/`, and the root composition at `src/model/InfraBridge.tsx`. Props, named authored dimensions, engineering semantics, and geometry remain together with their definition.

The Reference Harness lives separately at `reference/infra-bridge/`. Reference IFC inspection, imported identifiers, extracted transforms, comparison mappings, and generated reports are forbidden from `examples/infra-bridge/`, and the authored project must never import the harness.

Major structural Occurrences are written explicitly so readers can see the bridge hierarchy. Procedural generation is reserved for true regular patterns such as posts, sleepers, and stiffeners, and still produces stable Semantic Keys. The model composes one `RoadGirderBridge` Assembly and two keyed Occurrences of a parameterized `RailArchBridge` Assembly rather than defining a file for every physical occurrence.

## Considered options

- Keep evolving the ignored `tmp/infra-bridge-prototype`: rejected because it combines forensic reconstruction, authored geometry, export, and verification into one disposable directory.
- Put the bridge under `apps/` or `packages/`: rejected because it is neither a deployed UI nor a reusable library.
- Generate all occurrences from extracted data arrays: rejected because source structure and engineering intent disappear behind opaque inventory data.
- Duplicate the two rail bridges as separate definitions: rejected because their common engineering structure should be expressed once and varied through meaningful parameters.
- Add local transform or IFC compatibility adapters in the example: rejected because they would normalize missing platform capabilities into project conventions.

## Consequences

Before full remodeling, `brepjs-families` must support first-class TSX children and fragments, Assemblies, nested rigid Local Frames including rotation, and infrastructure-aware IFC Projection. A thin vertical slice consisting of a deck, girder, pier, IFC export, and reference comparison must prove this authoring path before the remaining components are produced.
