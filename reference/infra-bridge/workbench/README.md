# Infra-bridge Reconstruction Workbench

This private local app opens with the complete checksummed IFC4X3 Reference Model beside the
complete authored Candidate Model, then provides product-level reconstruction diagnosis and a
read-only TSX-to-render inspection mode. Reference decoding, authored TSX evaluation,
normalization, source-file access, syntax highlighting, and scoring stay on the local Node side;
the browser receives plain diagnostic meshes, highlighted markup, and Fidelity Gate evidence.

From the repository root, run:

```sh
npm -C reference/infra-bridge run workbench:dev -- --ifc ../../tmp/Infra-Bridge.ifc
```

The IFC path is resolved from `reference/infra-bridge/` and verified against
`referenceManifest.json`. Use `--host` or `--port` after `--ifc` when a non-default local bind is
needed.

The fixed three-icon sidebar selects the level of investigation:

- **Overall comparison** (default) shows the complete Reference and Candidate Models in two
  bright, equal side-by-side canvases. The shared toolbar applies camera presets, projection,
  fit, and grid state to both views.
- **Manifest products** exposes the original Semantic Key rail, Reference/Candidate/Overlay
  canvas, independent layer controls, section plane, Fidelity Gate evidence, and all 47 products.
- **Component source** keeps the Semantic Key selection and places the server-approved Family TSX
  source beside that occurrence's canonical Candidate render. Source is read-only, server-
  highlighted with Shiki, and restricted to a closed Family-file allowlist; browser requests never
  contain file paths.

Saving an infra-bridge TSX file recomputes the active mode; **Recompute** performs the same refresh
explicitly while keeping the active mode, selected component, and useful view state. Component
Source refreshes its code and geometry at one monotonic revision while retaining source scroll and
camera-control state.

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
