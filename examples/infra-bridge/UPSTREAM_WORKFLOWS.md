# Extraction readiness and upstream follow-ups

This record distinguishes what is proven inside Infra Bridge from work that belongs to the future brepjs framework or the external Reference Harness.

## Standalone verdict

The folder is designed to be copied into its own Git repository and run with Node 24:

```sh
npm ci
npm run check
npm run preview
npm run verify:ifc
```

`npm run verify:standalone` performs that proof in an isolated temporary copy. It excludes ambient `node_modules`, build products, previews, and npm caches; verifies the repository boundary and vendored hashes before install; then executes the locked install and acceptance commands.

The extraction-ready workflow is already present at `.github/workflows/ci.yml`. It is inert while this folder remains nested in the brepjs monorepo and becomes active when the folder is made a repository root.

## Blockers resolved locally

| Former blocker                                | Local resolution                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unpublished workspace APIs                    | Frozen `brepjs`, `brepjs-bim`, and `brepjs-families` workspace snapshots in `vendor/`, identified by source commit and checksummed by `vendor/manifest.json` |
| Snapshot/release identity ambiguity           | Manifest schema 2 records artifact kind, source version, public latest metadata, and the distinct same-version registry artifact                             |
| Parent workspace installation                 | Own `package-lock.json`, exact dependency versions, Node/npm contract, and isolated `npm ci` proof                                                           |
| Parent ESLint and TypeScript paths            | Self-owned ESLint, Prettier, typecheck, and build configuration                                                                                              |
| Hoisted command-line tools                    | Every tool used by package scripts is declared locally                                                                                                       |
| Missing package Interface                     | Narrow root export in `src/index.ts` with emitted declarations under `lib/`                                                                                  |
| Parent-relative Reference Harness command     | Removed; reference comparison remains an external validation workflow                                                                                        |
| Projection adapter parity                     | Local projector now writes spatial `compositionType` with the same collection/element/partial mapping as the adapter                                         |
| Nondeterministic IFC header time              | Export accepts `SOURCE_DATE_EPOCH`; reproducibility is checked against `baselines/infra-bridge.ifc.json`                                                     |
| Missing extraction CI and repository guidance | Added `.github/workflows/ci.yml`, `README.md`, `AGENTS.md`, license, notices, and local ignore/tool files                                                    |

## IFC evidence

The Projection parity repair was checked on the original Node 23 environment and did not alter the IFC by one byte: the before and after files were both 468,752 bytes with SHA-256 `6ca32acbb7e94705780f2960abae437979fb41ff93de987ad095063194009fd5`.

Standalone acceptance uses Node 24. That runtime changes Open Cascade tessellation ordering and floating-point serialization details, so it intentionally establishes a separate reviewed baseline even with the IFC header date frozen. The committed Node 24 contract is 468,752 bytes with SHA-256 `08b430599c0893aef5f3b6bd07005b2fc5417ad91dbdda37c0f20575d3472f71`. `npm run verify:ifc` exports twice and requires byte-for-byte equality with that baseline.

`web-ifc` currently logs `GetLineType()` attempts for ExpressID 11 during validated export. The export still succeeds; the diagnostic is recorded rather than hidden.

## Work that should move upstream

These local fixes are intentional extraction seams, not necessarily the desired final framework design:

1. Publish coordinated, API-compatible prereleases of `brepjs`, `brepjs-bim`, and `brepjs-families` from the infrastructure feature line. Give every artifact a unique version; the frozen snapshots demonstrate why a released version number must not identify different bytes. Once compatible releases exist, replace `file:vendor/*.tgz` dependencies with exact registry versions and remove `vendor/` only after isolated acceptance passes.
2. Teach the upstream `familiesToBim()` adapter to project the complete nested `BridgePart -> BridgePart` hierarchy. Then delete `src/projectInfraBridge.ts` only after parity and IFC verification establish identical intended output.
3. Evaluate every file in `scripts-tbd-upstream/` for framework ownership. General-purpose boundary, provenance, isolated-install, and deterministic-export capabilities should become upstream tooling; project-specific policy should remain here.
4. Keep the Reference Harness external. After extraction, update it to consume this package's public Interface or an immutable artifact instead of importing source paths.
5. Update parent-repository workspace entries, scaffolder snapshots, path-based docs, and Reference Harness paths only as a separate extraction change. This standalone preparation deliberately does not modify them.

## Frozen dependency seam

The current artifacts are workspace snapshots from the exact Git commit in `vendor/manifest.json`. Their internal versions are inherited source metadata. They are byte-distinct from public npm tarballs with those same versions, and the registry's latest versions at freeze time do not expose the complete APIs required here.

Run the networked audit without changing the freeze:

```sh
npm run audit:releases
```

A clean audit means registry metadata still matches the recorded observation. It does not mean the snapshots are latest releases or that registry latest is compatible.

## Ending or refreshing the freeze

From this repository, point the refresh command at a compatible brepjs checkout:

```sh
npm run vendor:refresh -- /absolute/path/to/brepjs
npm run lock:refresh
npm run verify:vendor
npm run verify:standalone
```

`vendor:refresh` captures current registry evidence and replaces the frozen source commit. Review the source commit, snapshot hashes, registry comparison, and compatibility changes in `vendor/manifest.json`. A version number alone is insufficient because the required APIs exist on an unpublished workspace line.
