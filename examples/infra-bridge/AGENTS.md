# Infra Bridge agent rules

This repository is a substantial prototype and playground for a future infrastructure framework rooted in <https://github.com/andymai/brepjs>. Preserve that experimental purpose while keeping the example understandable as authored engineering code.

## Standalone boundary

- Treat this directory as the repository root. Product commands must not read files above it.
- Keep install, typecheck, lint, tests, build, preview, and IFC export independent of the Reference IFC and its external comparison harness.
- Put every new operational script in `scripts-tbd-upstream/`. Use dependency-free `.mjs`; these scripts are candidates for later upstream framework ownership.
- Do not add parent-relative config imports or package paths. Run `npm run check:boundary` after changing configuration.
- For vendor changes or release investigations, read `vendor/manifest.json` and `UPSTREAM_WORKFLOWS.md`. Treat the recorded artifacts as frozen workspace snapshots, not npm releases.
- Use `npm run audit:releases` to detect registry drift. A newer registry version is evidence to investigate; compatibility, isolated acceptance, and IFC verification decide an upgrade.
- End the dependency freeze only through `npm run vendor:refresh -- <brepjs-source-root>`, then run `npm run lock:refresh`, review the manifest, and complete standalone verification.

## Authored model

- Put project-wide engineering dimensions and placement coordinates in `src/setout.ts`; avoid unexplained numeric literals in Assemblies.
- Keep repeated Assembly structure DRY through shared occurrence templates while preserving Semantic Keys and Local Frame composition.
- Delete donor-derived metadata, materials, definitions, and helpers that have no effect on the intended IFC semantics, geometry, or BREP output.
- Keep the public package Interface narrow. Add exports through `src/index.ts` only when they are intentional consumers' concepts.
- Reference evidence may inform reconstruction decisions, but production source must not parse, import, or derive geometry from donor IFC bytes.

## Output contract

- Use Node 24 and the locked install (`npm ci`) for acceptance evidence.
- Run `npm run check`, `npm run preview`, and `npm run verify:ifc` after model changes.
- `npm run verify:ifc` must reproduce the IFC byte for byte. Treat a mismatch as a change requiring investigation, not an instruction to refresh the baseline.
- Change `baselines/infra-bridge.ifc.json` only after an intentional output change has been reviewed and the export has reproduced in an isolated install.
- Generated files belong in ignored `dist/` or `lib/`; do not commit them.
