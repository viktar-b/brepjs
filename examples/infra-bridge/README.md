# Infra Bridge

Infra Bridge is a standalone declarative bridge model and a substantial playground for exploring what a future infrastructure framework should look like. It is a prototype rooted in [andymai/brepjs](https://github.com/andymai/brepjs), not a finished framework or a claim that its temporary compatibility seams belong in the final platform API.

The model authors one road bridge and two Occurrences of one rail-arch Bridge definition. Its Families and Assemblies use typed props, engineering semantics, stable occurrence keys, named Datums, and nested rigid Frames. The authored source, tests, preview, IFC export, build configuration, and CI contract all live in this folder.

## Requirements

- Node.js 24 or newer (`.nvmrc` is provided)
- npm 11.6.1 or a compatible npm 11 release

The currently required `brepjs`, `brepjs-bim`, and `brepjs-families` APIs are not all available together from the public npm registry. Immutable workspace snapshots are therefore committed under `vendor/`. They are **not npm releases or latest-version claims**: their filenames carry the source commit, and `vendor/manifest.json` records the source version, snapshot hash, public latest release at freeze time, and the distinct public artifact carrying the same version number. Registry dependencies remain exactly pinned by `package-lock.json`.

## Start here

```sh
npm ci
npm run check
npm run preview
npm run verify:ifc
```

`npm run check` verifies the standalone boundary and vendored package hashes before typechecking, linting, testing, and building. `npm run verify:standalone` copies the repository into a temporary directory and proves that a fresh `npm ci`, full check, preview, and deterministic IFC export work without the parent monorepo.

The platform snapshots are frozen. `npm run audit:releases` is a manual networked audit that reports whether npm dist-tags have moved since the freeze; it never updates dependencies. A deliberate refresh uses `npm run vendor:refresh -- /path/to/brepjs`, `npm run lock:refresh`, and the complete standalone verification sequence.

Generated artifacts are written under `dist/` and are ignored by Git:

- `infra-bridge.ifc` — validated IFC4X3 export
- `preview.glb` — interactive mesh preview
- `previewIsometric.svg`, `previewPlan.svg`, and `previewElevation.svg` — review snapshots
- `preview.json` — evaluated product status

IFC verification exports twice with the fixed epoch recorded in `baselines/infra-bridge.ifc.json`, compares the two byte streams, then checks the committed byte length and SHA-256. Intentional output changes require review and an explicit baseline update; never refresh the baseline merely to make the gate pass.

## Package Interface

The deliberately narrow root export exposes only:

- `buildInfraBridge()` — resolve the declarative model
- `projectInfraBridge()` — project that resolved model to BIM
- `InfraBridgeProjection` — the projection result type

The local projector is a compatibility seam for nested civil spatial structure that the current public adapter cannot project completely. It reads only resolved authored semantics and Frames; reference IFC bytes never enter normal build, preview, test, or export workflows.

## Repository conventions

Operational scripts are dependency-free `.mjs` files under `scripts-tbd-upstream/`. The name is intentional: these scripts are extraction necessities and candidates for future ownership by the upstream framework. See `AGENTS.md` for editing rules and `UPSTREAM_WORKFLOWS.md` for extraction evidence and remaining upstream work.

Reference-IFC comparison remains an external validation harness. It is intentionally absent from this repository's default commands so the authored model cannot silently depend on donor bytes.

The sign backing and visible lettering are authored geometry. The minimal project-owned OpenType font in `src/fonts/projectFont.ts` keeps preview and export reproducible without a system-font dependency.
