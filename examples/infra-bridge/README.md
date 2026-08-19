# Declarative infrastructure bridge

This private example authors one road bridge and two Occurrences of one rail-arch Bridge definition. Its Families and Assemblies use typed props, engineering semantics, stable occurrence keys, named Datums, and nested rigid Frames. Ordinary build, preview, tests, and IFC export are independent of the reference IFC.

```sh
npm -C examples/infra-bridge run check
npm -C examples/infra-bridge run preview
npm -C examples/infra-bridge run export:ifc
```

The separate Reference Harness comparison is the only command that accepts reference bytes:

```sh
npm -C examples/infra-bridge run reference:compare -- --ifc tmp/Infra-Bridge.ifc
```

Generated artifacts are written under `examples/infra-bridge/dist/`:

- `infra-bridge.ifc` — typed IFC4X3 export;
- `preview.glb` — interactive mesh preview;
- `previewIsometric.svg`, `previewPlan.svg`, and `previewElevation.svg` — review snapshots;
- `preview.json` — evaluated product status.

The current public `familiesToBim()` civil adapter rejects the source's nested `BridgePart → BridgePart` hierarchy and returns no usable partial projection. `src/projectInfraBridge.ts` is one recorded fallback module, but it projects the entire model through public `BimModel` methods: zero full-model Occurrences use the preferred adapter. It reads the same resolved semantics and Frames, and a non-nested parity test protects it against adapter drift. No reference data enters that fallback.

The sign backing and visible lettering are authored geometry, but the lettering uses a declared project block font. The public text-to-BRep API returns a materialized kernel shape that the declarative CSG IR cannot currently embed, so exact font-outline authoring remains a documented API gap.
