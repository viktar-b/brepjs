# Infra-bridge Reconstruction Workbench

This private local app compares one authored infra-bridge Occurrence with its checksummed
IFC4X3 Reconstruction Target in a shared component-local frame. Reference decoding, authored
TSX evaluation, normalization, and scoring stay on the local Node side; the browser receives
plain diagnostic meshes and Fidelity Gate evidence.

From the repository root, run:

```sh
npm -C reference/infra-bridge run workbench:dev -- --ifc ../../tmp/Infra-Bridge.ifc
```

The IFC path is resolved from `reference/infra-bridge/` and verified against
`referenceManifest.json`. Use `--host` or `--port` after `--ifc` when a non-default local bind is
needed.

Select any Semantic Key in the left rail, switch among Reference, Candidate, and Overlay modes,
and use the independent layer, section, camera, projection, fit, and grid controls. Saving an
infra-bridge TSX file recomputes the selected comparison; **Recompute** performs the same refresh
explicitly while keeping the selected component and current view useful.

Failures appear in both the viewport and evidence ledger with their stage, stable code, context,
and a concrete recovery action. Correct a retryable authored/evaluation problem in the TSX source,
then save or choose **Retry/Recompute**. For a non-retryable Reference selection/decode failure,
correct the configured file or manifest and restart the workbench; checksum mismatches are never
bypassed.

Focused verification:

```sh
npm -C reference/infra-bridge run workbench:check
npm -C reference/infra-bridge run workbench:smoke -- --ifc ../../tmp/Infra-Bridge.ifc
```
