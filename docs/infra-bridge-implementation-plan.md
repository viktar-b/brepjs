# Declarative infra-bridge implementation plan

This plan implements the architecture recorded in `CONTEXT.md` and ADRs 0001–0007. Its product is a clean, declarative brepjs bridge model; the Reference IFC remains external evidence used by a separate reconstruction and verification system.

## Outcome

The finished repository contains:

- a declarative runtime that preserves Model, Assembly, and Family structure, semantics, identity, and nested rigid Frames;
- infrastructure-aware BIM projection that emits Bridge, BridgePart, and correctly typed civil products;
- a representation-aware Reference Harness that decodes IFC geometry, prepares component-local Reconstruction Targets, scores Candidate Families, and compares the finished Model;
- a private example project whose ordinary source is readable without the Reference IFC;
- one authored road bridge and two Occurrences of one authored rail-arch bridge definition;
- exactly 3 Bridges, 18 BridgeParts, and 47 scoped products at completion.

## Non-goals

- Preserving source Express IDs or GlobalIds in the authored Model.
- Importing a source inventory, transforms, vertices, or meshes into component source.
- Integrating CADENA weights or its CadQuery DSL in the first implementation.
- Reconstructing out-of-scope road, parking, highway-marker, bearing, alignment, pile, or reinforcement objects.
- Starting full bridge geometry before the vertical slice proves the runtime, projection, and comparison path.

## Module seams

### 1. Declarative model runtime

**Location:** `packages/brepjs-families`

**Interface:** callers define a `family()`, `assembly()`, or `model()`, construct keyed TSX Occurrences with validated Frames and Engineering Semantics, and call `resolve()` to receive a Resolved Model.

**Hidden implementation:** JSX child normalization, Fragment flattening, definition evaluation, key validation, Frame validation and composition, intrinsic geometry projection, and resolved-tree construction.

**Observable result:** every authored definition boundary survives resolution with its definition kind, key path, local Frame, world Frame, semantics, geometry, and children.

This Module is in-process and is tested directly through its Interface. No adapter seam is needed.

### 2. Infrastructure BIM projection

**Location:** `packages/brepjs-bim`

**Interface:** callers project a Resolved Model with project/site/georeferencing options and receive a typed BIM result or a structured error.

**Hidden implementation:** semantic routing, stable identity generation, Project/Site/Bridge/BridgePart aggregation, spatial containment, material association, typed product construction, Product Body selection, IFC serialization, and analytic-versus-tessellated representation choice.

**Observable result:** infrastructure semantics produce infrastructure spatial structure. No Building or Storey is synthesized for the bridge Model, and no recognized civil product becomes `IfcBuildingElementProxy`.

Existing building projection remains supported through the same public projection entry point. Tests exercise projected model records and serialized/reimported IFC rather than internal routing tables.

### 3. Reference reconstruction

**Location:** `reference/infra-bridge`

**Interface:** the harness loads a checksummed reference, exposes a component-local Reconstruction Target for a Semantic Key, scores evaluated Candidate Family geometry, and compares a complete authored Model.

**Hidden implementation:** IFC traversal, placements, unit conversion, representation dispatch, tessellation indexing, B-Rep evidence extraction, surface sampling, normal-aware matching, volume/envelope checks, Reference Manifest lookup, and report generation.

This Module has a real internal adapter seam because at least three source representations vary:

- parametric IFC geometry;
- IFC tessellated or polygonal face sets;
- analytic B-Rep geometry.

Adapters preserve the strongest available evidence but converge on the Reconstruction Target contract. Adapter-specific types do not leak into the external Interface.

The first reconstruction loop is agent-driven: prepare a target, author or modify a Candidate Family, execute it, score it, and repeat. A learned operation proposer may be added later without changing the Reference Harness Interface.

## Target repository shape

```text
examples/infra-bridge/
├── package.json
├── README.md
├── src/
│   ├── families/
│   │   ├── AbutmentCapBeam.tsx
│   │   ├── ApproachSlab.tsx
│   │   ├── ArchRib.tsx
│   │   ├── BridgeDeck.tsx
│   │   ├── BridgeRailing.tsx
│   │   ├── BridgeSign.tsx
│   │   ├── CrossGirder.tsx
│   │   ├── EarthFill.tsx
│   │   ├── Footing.tsx
│   │   ├── MainGirder.tsx
│   │   ├── PierStem.tsx
│   │   └── SpandrelWall.tsx
│   ├── assemblies/
│   │   ├── RailArchBridge.tsx
│   │   ├── RailArchSuperstructure.tsx
│   │   ├── RailPier.tsx
│   │   ├── RoadAbutment.tsx
│   │   ├── RoadGirderBridge.tsx
│   │   └── RoadPier.tsx
│   ├── model/
│   │   └── InfraBridge.tsx
│   ├── materials.ts
│   └── main.ts
└── tests/

reference/infra-bridge/
├── package.json
├── README.md
├── reference-manifest.json
├── src/
│   ├── loadReference.ts
│   ├── reconstructionTarget.ts
│   ├── scoreCandidate.ts
│   ├── compareModel.ts
│   └── representations/
│       ├── parametricIfc.ts
│       ├── tessellatedIfc.ts
│       └── analyticBrep.ts
└── tests/
```

Implementation filenames inside the packages may change to preserve locality. The external Interfaces and product/reference separation are normative.

## Gate 1 — declarative runtime and reconstruction contracts

### Runtime work

1. Add failing Interface tests for definition kinds, typed TSX children, Fragment flattening, preserved boundaries, Semantic Keys, duplicate-key errors, and nested Frames.
2. Add `assembly()` and `model()` alongside the existing `family()` Interface.
3. Make accepted JSX children available to the definition render function; reject them through types where a props contract omits children.
4. Preserve each definition boundary rather than collapsing wrapper definitions into their first intrinsic element.
5. Introduce a validated rigid Frame with origin, x-axis, and z-axis; derive y-axis and compose Frames through the authored tree.
6. Put local Frame, world Frame, definition kind, and Engineering Semantics on every resolved node.
7. Keep translation transforms working for existing callers, but do not use them in new bridge code.

### Reference contracts

1. Define source-neutral `ReferenceScene`, `ReconstructionTarget`, surface observation, and optional analytic-evidence contracts under `reference/infra-bridge`.
2. Define structured errors for unsupported representation, invalid indices, placement failure, unit failure, open/invalid topology, and checksum mismatch.
3. Add synthetic tests showing that different representation adapters can produce the same target without leaking their source-specific types.
4. Do not parse `Infra-Bridge.ifc` or create bridge component files in this gate.

### Gate 1 exit

- Existing families tests remain green.
- New behavior is tested through `family()`, `assembly()`, `model()`, and `resolve()`.
- Nested rotated Frames produce the same world placement for resolved geometry and metadata.
- The Reference Harness contracts compile and are proven with tiny synthetic fixtures.

## Gate 2 — infrastructure BIM and reference adapters

### BIM work

1. Add typed Bridge and BridgePart records, specs, model methods, relationships, serializer paths, and reimport coverage.
2. Add typed Member, Sign, and EarthworksFill paths.
3. Reuse and extend Beam, Column, Slab, Wall, Footing, and Railing paths.
4. Introduce a shared Product Body abstraction supporting the strongest analytic representation available and evaluated authored tessellation otherwise.
5. Route projection using Engineering Semantics rather than Family display names.
6. Consume resolved Frames directly; remove geometry-IR placement inference from new paths.
7. Derive deterministic identities from Semantic Key paths.

### Reference work

1. Implement the tessellated IFC adapter first: decode the containing face set, coordinate list, `CoordIndex`, optional `PnIndex`, closedness, units, styles/materials, and composed placements.
2. Preserve shared source geometry as repetition evidence without treating it as authored identity.
3. Implement parametric IFC and analytic B-Rep adapters against the same Reconstruction Target tests.
4. Implement physical-unit surface distance, normal agreement, envelope, volume, and closed-solid IoU scoring.
5. Add the checksummed Reference Manifest outside the product.

### Gate 2 exit

- A synthetic `Project → Site → Bridge → BridgePart → products` model exports, validates, and reimports.
- All required civil products retain their correct IFC classes.
- The three representation adapters satisfy the same target contract tests.
- A known indexed face set is decoded with correct one-based indexing, placement, units, orientation, and bounds.

## Gate 3 — road-bridge vertical slice

Create only:

```text
InfraBridge
└── RoadGirderBridge
    ├── deck
    │   ├── BridgeDeck
    │   └── MainGirder
    └── pier
        └── RoadPier
            ├── CrossGirder
            ├── PierStem
            └── Footing
```

For each leaf:

1. Prepare its component-local Reconstruction Target.
2. Author a Candidate Family using named dimensions and brepjs operations.
3. Execute and compare after every meaningful operation or parameter revision.
4. Accept it only after its Datum, readability, semantics, invariant tests, and applicable Fidelity Gates pass.
5. Place it using semantic keys and nested Frames.

### Gate 3 exit

- `npm run check`, `npm run preview`, and `npm run export:ifc` require no Reference IFC.
- `npm run reference:compare -- --ifc <path>` is the only reference-dependent command.
- The slice previews correctly, preserves resolved hierarchy, exports typed infrastructure IFC, validates, reimports, and passes its applicable reference comparisons.
- A cleanliness test rejects any reference import, source identity, absolute source path, raw transform matrix, inventory file, or reference-derived vertex array in the authored project.

## Gate 4 — remaining authored bridge definitions

1. Complete the road bridge using explicit major Occurrences and procedural generation only for genuine regular patterns.
2. Author `RailPier` and `RailArchSuperstructure` from approved leaf Families.
3. Author one parameterized `RailArchBridge` and instantiate it twice.
4. Author visible sign lettering through text-to-BRep and a declared project font.
5. Keep all definitions project-local; defer registry promotion until a second independent model proves a reusable Interface.

### Gate 4 exit

- Every planned Family and Assembly has one primary definition file and focused tests.
- The authored Model contains 3 Bridges, 18 BridgeParts, and 47 products.
- No structural product uses reference-derived tessellation or an IFC proxy route.

## Gate 5 — full fidelity and retirement

Run and report each Fidelity Gate independently:

- exact object and hierarchy counts;
- per-product semantic key, IFC class, containment, and material;
- deterministic generated GlobalIds;
- simple dimensions within 2 mm;
- control-point placement within 5 mm;
- whole-bridge envelope within 10 mm per face;
- comparable volumes within 2%;
- curved-profile surface distance and normal agreement;
- zero IFC validation errors and successful reimport;
- separate visual approval.

After the new Reference Harness reproduces every forensic capability still needed from `tmp/infra-bridge-prototype`, retire that prototype. Deletion is a separate explicit action and is not part of an earlier gate.

## First implementation task

Implement Gate 1 only. The change must be reviewable without understanding bridge geometry and must not create `examples/infra-bridge`, parse the Reference IFC, or alter BIM serialization. Its purpose is to prove the two foundational Interfaces: declarative resolution and source-neutral Reconstruction Targets.

The first implementation review should answer:

- Is the runtime Module deeper for callers, or did complexity leak into every Family?
- Can tests exercise all behavior through the same Interface callers use?
- Does the Resolved Model preserve enough authored information that Projection never inspects geometry recipes for identity, hierarchy, semantics, or placement?
- Can a future representation adapter add rich evidence without changing Candidate Family authoring?
