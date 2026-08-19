# Infrastructure bridge Reference Harness

This private package owns all Reference IFC selection, inspection, decoding, repetition evidence, scoring, and generated comparison reports. Candidate Families see only the source-neutral public contracts exported by `@brepjs/infra-bridge-reference`.

```sh
npm run check:infra-bridge-reference
npm -C reference/infra-bridge run report:inventory -- --ifc tmp/Infra-Bridge.ifc
npm -C reference/infra-bridge run compare:model -- --ifc tmp/Infra-Bridge.ifc
```

The inventory and comparison commands write ignored JSON evidence under `reference/infra-bridge/tmp/`. The comparison also writes Reference/output/overlay panels for isometric, plan, and elevation views under `reference/infra-bridge/tmp/visual/`; each three-panel view uses one recorded camera for all lanes. The checksummed `referenceManifest.json` is the only committed mapping from authored Semantic Keys to identities in the exact Reference IFC.

See `reconstructionReport.md` for the reconstruction specification, measured fidelity, public-API fallbacks, and gap matrix.
