---
name: reconstruct-infra-family
description: Reconstruct or refine one bridge/civil leaf component from a source-neutral Reference Harness target into a clean project-local brepjs TSX Family. Use for infrastructure Family geometry, datum calibration, named dimensions, semantic authoring, candidate scoring, or leaf-level fidelity repair.
---

# Reconstruct one infrastructure Family

Work on one leaf definition at a time. Keep reference evidence in `reference/infra-bridge`; keep the accepted Family understandable and executable without the Reference IFC.

## 1. Prepare the target

Load the checksummed reference through the public Reference Harness Interface and select the occurrence through its manifest Semantic Key. Record, in a reference-only working artifact:

- component-local comparison bounds, surface, closedness, and volume;
- named analytic or dimensional evidence when available;
- scene placement separately from component geometry;
- material, name, IFC role, and repetition evidence.

Completion criterion: one source-neutral `ReconstructionTarget` and its separate scene Frame account for all evidence used below.

## 2. Distill the authored specification

Translate evidence into human-authored engineering intent:

- typed named dimensions in millimetres;
- a documented Datum and local +X/+Y/+Z convention;
- material and target-independent Engineering Semantics;
- shape invariants and applicable Fidelity Gates;
- explicit assumptions for evidence that does not determine intent.

Use `brainstorm`, then `design`, to choose the smallest reliable brepjs operation sequence. Prefer boxes/extrusions and planar profiles before sweeps, lofts, or booleans.

Completion criterion: the specification can be reviewed without opening the Reference IFC.

## 3. Author exactly one Family

Create or edit one primary `.tsx` file under `examples/infra-bridge/src/families/`:

- validate typed props at the definition boundary;
- attach definition-owned Engineering Semantics derived only from typed props;
- build geometry around the documented Datum with brepjs CSG IR operations;
- expose engineering dimensions rather than mesh data;
- leave placement to keyed Occurrences and nested rigid Frames.

Keep the authored file free of reference identities, paths, meshes, vertices, raw transform matrices, inventory records, and Reference Harness imports. A `.brep.ts` experiment may inform the operation design but is not the product source.

Completion criterion: the Family builds and its focused reference-independent test proves props, Datum bounds, invariants, and semantics.

## 4. Execute and score

Resolve and evaluate the real TSX Family through `brepjs-families`. Convert only the evaluated candidate mesh to a source-neutral comparison surface, then call the public Reference Harness scorer.

Report independently:

- envelope deltas;
- surface maximum, mean, and p95 distance;
- normal agreement;
- volume error when closed;
- closed-solid IoU when applicable.

Fix the smallest responsible dimension, Datum, or operation. Repeat after every meaningful revision.

Completion criterion: every applicable threshold passes without weakening the gate or changing the target.

## 5. Accept the Family

Run the project check and audit the definition for reference coupling. Confirm its IFC semantic kind, material, containment expectation, stable occurrence keys, and reusable prop surface.

Accept only when geometry, semantics, identity, hierarchy use, and cleanliness are all independently green. Record limitations as missing API/kernel capability rather than hiding them in geometry.
