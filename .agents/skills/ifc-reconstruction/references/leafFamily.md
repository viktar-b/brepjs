# Leaf Family workflow

Use this playbook for the tracer and for every leaf reconstruction or repair. Work on one definition at a time.

## 1. Prepare evidence

Select the occurrence through the checksummed manifest and Reference Harness public Interface. Record component-local bounds/surface, strongest analytic or dimensional evidence, closedness/volume, material/name/semantic role, repetition, and the separate scene Frame in reference-owned artifacts.

If the local surface is an inscription (sign, marker, raised or cut lettering), also record **readable text** as evidence. Render a component-local orthographic crop of that surface — not a whole-bridge screenshot — and read the string, line breaks, and glyph style from the image. Do not copy glyph vertices into product source. If the crop is unreadable, write `unidentified inscription`; do not invent a project slogan.

Completion: one source-neutral target plus one separate scene Frame accounts for all evidence used by the authoring loop. For a text-bearing leaf, that target includes the transcribed string or an explicit unidentified-inscription note.

## 2. Author the specification

Translate evidence into engineering intent:

- validated typed props and named physical dimensions;
- a documented Datum and the coordinate convention from [ADR-0004](../../../../docs/adr/0004-author-bridge-families-in-engineering-coordinates.md);
- definition-owned, target-independent Engineering Semantics derived from typed props;
- material, invariants, assumptions, and applicable gates;
- for inscriptions: the transcribed string as a typed named prop, plus an owned font or a recorded unknown-font assumption. Font approximation is allowed. Authoring a different word than the crop is a spec failure.

Use `brainstorm`, then brepjs `design`, to select a readable operation sequence. Prefer reliable primitives/profiles/extrusions before advanced sweeps, lofts, or booleans. Experiments may inform the design but are not accepted product source.

Completion: another engineer can review the specification without the Reference IFC.

## 3. Author one TSX Family

Create one primary reusable Family per TSX file. Build around the documented Datum with public brepjs CSG IR operations. Keep placement in keyed Occurrences and nested rigid Frames.

Do not put source identity, GlobalIds, Express IDs, meshes, vertices, raw transforms, inventories, absolute source paths, or Reference Harness imports in the Family. Never copy a decoded representation into product source.

Completion: a focused reference-independent test proves prop validation, named dimensions, Datum-relative bounds, invariants, semantic kind/material, and definition reuse.

## 4. Execute and compare

Resolve and evaluate the actual TSX Family. Convert only the evaluated candidate to the Reference Harness comparison surface. Compare local geometry in candidate-local coordinates; compare candidate and reference scene Frames separately.

Report applicable gates independently: face-wise envelope deltas, surface mean/p95/maximum, normal agreement, closed volume error, closed-solid IoU, origin/control-point deltas, and Frame orientation.

After each meaningful revision, diagnose the failed metric and change the smallest responsible dimension, Datum, or operation. Do not weaken a threshold or distort another independent gate.

## 5. Accept or record a gap

Accept only when focused tests, geometry, semantics, placement use, identity use, hierarchy expectation, and cleanliness are independently green. If the kernel or public API blocks fidelity, keep the failure explicit and add it to the gap matrix with owning layer, severity, workaround, and smallest proposed capability.
