---
name: ifc-reconstruction
description: Reconstruct IFC files as clean declarative brepjs projects and verify them against source evidence. Use for a full IFC reconstruction, IFC remodeling, source-vs-authored comparison, refinement of an existing reconstruction, document-fidelity assessment, or claims that an authored model is an IFC replacement.
---

# IFC reconstruction

Treat the Reference IFC as evidence, never as runtime product input. Build an understandable authored model, project it through public APIs, and report each fidelity dimension independently.

## Start here

1. Read [architecture sources](references/architectureSources.md); follow its linked ADRs instead of restating their decisions.
2. Create a path configuration with `authored_project_root`, `reference_harness_root`, `reference_manifest_path`, `reference_ifc_path`, `evidence_root`, `output_ifc_path`, and `report_path`. Never infer a fixed repository layout.
3. Write both the Reconstruction Capability Profile and IFC Document Fidelity/Capability Profile before bulk authoring.
4. Make a blocker-ordered plan. Prove one tracer bullet through authoring, export, reimport, and comparison before expanding the component tree.
5. Keep ordinary authored-project check, preview, and export commands independent of the Reference IFC. Only the Reference Harness comparison receives `reference_ifc_path`.

## Route by phase

| Phase                                                                                         | Read                                                             | Completion signal                                                                          |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Intake, source inventory, manifest, hierarchy, materials, repetition, representation evidence | [intake and evidence](references/intakeAndEvidence.md)           | Checksummed manifest and both capability profiles cover scoped and whole-file evidence.    |
| Component-local targets and tracer project                                                    | [targets and tracer](references/targetsAndTracer.md)             | Local target and scene Frame are separate; one leaf proves the complete seam.              |
| One leaf Family or leaf repair                                                                | [leaf Family](references/leafFamily.md)                          | One typed TSX Family passes focused, semantic, cleanliness, and applicable fidelity gates. |
| Assembly, complete Model, Projection, export                                                  | [model and projection](references/modelAndProjection.md)         | Stable keys/Frames compose; IFC validates and reimports; every fallback is recorded.       |
| Independent gates, document classification, gap analysis, handoff                             | [verification and handoff](references/verificationAndHandoff.md) | All gates have evidence; the replacement claim does not exceed document fidelity.          |

Use the [readiness matrix](references/readinessMatrix.md) for final package and reconstruction acceptance.

## Non-negotiable boundaries

- Inspect and select source data only through the configured Reference Harness public Interface.
- Decode a complete representation item; never promote a coordinate list to geometry by itself. Preserve the strongest tessellated, parametric, or analytic B-Rep evidence lane.
- Keep component-local geometry separate from scene/world placement.
- Keep authored source free of donor identity, GlobalIds, Express IDs, meshes, vertices, raw matrices, inventory dumps, absolute donor paths, and Reference Harness imports.
- Give every reusable Family or Assembly one primary TSX file. Use typed named dimensions, a documented Datum, definition-owned Engineering Semantics, nested rigid Frames, and stable Semantic Keys.
- Prefer `brepjs-families → CSG IR → familiesToBim → IFC`. Use direct `BimModel` APIs only for a demonstrated adapter gap, and record the fallback and owning layer.
- Never weaken thresholds, alter the target, or embed source evidence to make a gate pass. Repair the smallest responsible Family, Assembly, Projection, or decoder layer.

## Done means

- Geometry, hierarchy, semantics, relationships, materials, placement, identity, serialization, coverage, and visual fidelity were verified independently.
- Source and output IFC document capabilities were compared, including every placed non-spatial source object.
- The final report distinguishes exact reconstruction, authored parametric intent, exported representation meaning, visual approximation, scoped omission, and missing API capability.
- The result states “no reconstruction level accepted” when the minimum gates fail; otherwise it names only the highest evidenced level: scoped geometric reconstruction, scoped semantic/product model, federation-compatible replacement, or drop-in IFC-document replacement.
- Package mechanics pass `python3 .agents/skills/ifc-reconstruction/scripts/validatePackage.py .agents/skills/ifc-reconstruction` and the skill-creator validator.
