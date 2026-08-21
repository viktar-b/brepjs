# Upstream workflows this folder still needs

This package is authored as a self-contained example, but it is not yet a standalone repository. Ordinary source, tests, preview, and IFC export live here. Install, lint, typecheck, lockfile, CI, and the library APIs they resolve still come from the parent `brepjs` monorepo.

Use this file as the checklist when extracting the folder or pointing a new repo's workflows at it.

## Verdict

- Authored model, families, assemblies, tests, preview, and IFC export **are inside this folder**.
- A copy of this folder **cannot** `npm install` + `npm run check` on its own.
- The code is written against **unpublished workspace APIs** in `brepjs-families` and `brepjs-bim`. Installing those packages from npm is not a substitute.

## Commands run (2026-08-21)

Host default: Node `v23.6.0` / npm `11.0.0`. Working toolchain: Homebrew Node `v24.19.0` / npm `11.17.0` at `/opt/homebrew/opt/node@24/bin`.

### Inside the monorepo (`examples/infra-bridge`)

| Command | Result |
| --- | --- |
| `npm install` on Node 23 | Fail `EBADENGINE`: parent `brepjs` requires `node >= 24` |
| `npm install` on Node 24 | Pass (workspace hoist into repo root) |
| `npm run typecheck` (`tsgo`) | Pass |
| `npm run lint` | Pass |
| `npm run test` | **32 pass, 1 fail** (`tests/projectionFallback.test.tsx`: fallback site spec missing `compositionType: 'ELEMENT'` that `familiesToBim()` now writes) |
| `npm run preview` | Pass (`dist/preview.json`, `preview.glb`, three SVGs) |
| `npm run export:ifc` | Pass (`dist/infra-bridge.ifc`, 468752 bytes). `web-ifc` logged `GetLineType()` on ExpressID 11 |

`npm run check` is `typecheck && lint && test`, so it currently fails on the parity test.

### Isolated copy (`/tmp/infra-bridge-standalone-audit`)

Same files, no parent tree.

| Command | Result |
| --- | --- |
| `npm install` on Node 24 | Pass. `*` resolved to **npm latest**, not workspace versions: `brepjs@18.151.0`, `brepjs-bim@0.17.0`, `brepjs-families@0.7.1`, `typescript@7.0.2`, `vitest@4.1.11` |
| `npm run typecheck` | Fail: `tsgo` not installed |
| `npm run lint` | Fail: `eslint` not installed |
| `npm run test` | 2 pass (`cleanliness`, `snapshotRenderer`); 7 TSX suites fail: published `brepjs-families` has no `./jsx-dev-runtime` export |
| After adding eslint / tsgo / tsx / `@types/node` / `occt-wasm` | `eslint` still fails: config imports `../../eslint.config.js` → `/private/eslint.config.js` |
| `tsgo --noEmit -p tsconfig.typecheck.json` | Fail: published APIs lack `assembly`, `model`, `frame`, `EngineeringSemantics`, `BimModel.addBridge`, … |
| `tsx src/preview.ts` | Fail: published `brepjs-families` has no runtime export `frame` |

Workspace versions this example actually typechecks against: `brepjs@18.150.1`, `brepjs-bim@0.16.1`, `brepjs-families@0.7.0`. Those npm tags are **behind** the unpublished local APIs even when the published *numbers* are higher.

## Present in this folder

Keep these as the product when extracting:

- `src/` — families, assemblies, model, materials, setout, frames, bundled font bytes, preview, IFC export, BIM fallback projector
- `tests/`
- `package.json`, `README.md`, `tsconfig.json`, `tsconfig.typecheck.json`, `vitest.config.ts`, `eslint.config.js`

The OpenType sign font is inlined in `src/fonts/projectFont.ts`. No separate `assets/fonts/` file is required for preview/export.

## Missing from this folder

### 1. Files that point outside the folder

| File | Outside reference | What a standalone repo needs |
| --- | --- | --- |
| `eslint.config.js` | `import rootConfig from '../../eslint.config.js'` | Own ESLint config. Copy the shared rules from repo-root `eslint.config.js` (`@eslint/js` + `typescript-eslint` strict type-checked, plus the rules this package already overlays). |
| `tsconfig.typecheck.json` | `paths` → `../../dist/index.d.ts`, `../../packages/brepjs-bim/dist/index.d.ts`, `../../packages/brepjs-families/dist/*.d.ts` | Delete `paths`. Resolve types from `node_modules` after pinning workspace-compatible packages. |
| `package.json` `reference:compare` | `npm -C ../../reference/infra-bridge run compare:model` | Drop the script, or vendor/publish `@brepjs/infra-bridge-reference` and call it as a dependency. Ordinary `check` / `preview` / `export:ifc` must not require it. |
| `README.md` | Commands are `npm -C examples/infra-bridge …`; artifact paths are `examples/infra-bridge/dist/…` | Rewrite as in-repo `npm run …` and `dist/…`. |

### 2. Tools used by scripts but not declared here

`package.json` scripts call binaries that only exist because the parent workspace hoists them:

| Binary / package | Used by | Parent pin (copy these) |
| --- | --- | --- |
| `tsgo` (`@typescript/native-preview`) | `typecheck` | `7.0.0-dev.20260707.2` |
| `eslint`, `@eslint/js`, `typescript-eslint` | `lint` | `eslint@10.8.1`, `@eslint/js@10.0.1`, `typescript-eslint@8.66.0` |
| `tsx` | `preview`, `export:ifc` | `4.23.11` |
| `@types/node` | `tsconfig.json` `"types": ["node", "vitest/globals"]` | `26.2.0` (as in `reference/infra-bridge`) |
| `occt-wasm` | `await import('brepjs/quick')` in preview, export, and every geometry test | `4.2.0` (optional peer of `brepjs`; not installed unless declared) |
| `web-ifc` | `toIfcValidated` / `fromIfc` | `^0.0.77` (peer of `brepjs-bim`) |
| `prettier` | parent format/lint-staged only; this package has no format script | `3.9.6` + repo-root `.prettierrc.json` |

Also replace workspace `"*"` with real ranges. `"typescript": "*"` installed `7.0.2` in isolation; the workspace uses `6.0.3`.

Suggested dependency shape once the matching library versions are published:

```json
{
  "engines": { "node": ">=24" },
  "packageManager": "npm@11.6.1",
  "dependencies": {
    "brepjs": "file: or published build of 18.150.1 workspace",
    "brepjs-bim": "file: or published build of 0.16.1 workspace",
    "brepjs-families": "file: or published build of 0.7.0 workspace",
    "occt-wasm": "4.2.0",
    "web-ifc": "^0.0.77",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "26.2.0",
    "@typescript/native-preview": "7.0.0-dev.20260707.2",
    "eslint": "10.8.1",
    "tsx": "4.23.11",
    "typescript": "6.0.3",
    "typescript-eslint": "8.66.0",
    "vitest": "4.1.10"
  }
}
```

Until those workspace APIs are on npm, `file:` / git submodule / `npm pack` of `packages/brepjs-families` and `packages/brepjs-bim` (and root `brepjs`) is required. Registry latest is not API-compatible.

### 3. Repo files a standalone checkout needs

None of these exist in this folder today:

- `package-lock.json` (only the parent lockfile records this workspace)
- `.gitignore` (`node_modules`, `dist`)
- `.nvmrc` or `engines.node` (`>=24`)
- `.prettierrc.json`
- `.github/workflows/*` CI that runs `npm ci` + `npm run check` (and optionally `preview` / `export:ifc`)
- own ESLint config (see §1)

`create-brepjs` `bim/bridge/v1` also expects files this example does not have (`.gitignore`, `AGENTS.md`, `THIRD_PARTY_NOTICES.md`, `brepjs.config.ts`, `assets/fonts/infra-bridge-block.otf`, `docs/*`, `requirements/*.ids`). Those are scaffolder output, not runtime requirements for the current scripts.

## Unpublished APIs this source imports

These symbols are used here and exist in the **workspace** packages. They are **absent** from npm `brepjs-families@0.7.1` and `brepjs-bim@0.17.0`.

### `brepjs-families` (workspace `0.7.0`)

Publish or pack a build that exports:

- `assembly`, `model`, `frame`, `type Frame`
- `type EngineeringSemantics` (and civil semantics used on families)
- `./jsx-dev-runtime` (Vitest/Vite development JSX; workspace has it, npm `0.7.1` only has `./jsx-runtime`)
- occurrence `frame` prop (`WithKey.frame`)
- `ResolvedElement.semantics`, `.localFrame`, `.worldFrame`

Workspace `src/index.ts` already exports these. npm `0.7.1` `dist/index.d.ts` only exports `family`, `el`, `jsx`/`jsxs`/`Fragment`, `resolve`, `evaluateModel`.

### `brepjs-bim` (workspace `0.16.1`)

Publish or pack a build that exports:

- `parseBridgeSpec`, `parseBridgePartSpec`, `parseMemberSpec`, `parseSignSpec`, `parseEarthworksFillSpec`
- `BimModel.addBridge`, `.addBridgePart`, `.addMember`, `.addSign`, `.addEarthworksFill`
- `BimModel.getBridges`, `.getBridgeParts`, `.getEarthworksFills`, `.getMembers`, `.getSigns`
- `type ProductBody` and `productBody` on product elements
- `familiesToBim(..., { evaluatedModel })`
- `compositionType` on site / bridge / bridge-part specs (parity test currently fails because `src/projectInfraBridge.ts` does not yet write the default `'ELEMENT'` that `familiesToBim()` writes)

### `brepjs` (workspace `18.150.1`)

Imports used here that a standalone install must keep resolving:

- `csg`, `unwrap`, `err`, `ok`, `type Result`, `getBounds`, `type Bounds3D`, `type ShapeMesh`, `exportGlb`, `loadFont`
- `blueprintToContour`, `textBlueprints`, `type Blueprint`, `type CompoundBlueprint`
- `brepjs/quick` (needs `occt-wasm` or `brepjs-opencascade` at runtime)

`brepjs@*` from npm installed `18.151.0` and did not by itself provide the families/BIM APIs above.

## Parent workflows to adapt

These currently assume this directory stays at `examples/infra-bridge` inside the `brepjs` repo.

| Workflow | Current behaviour | Standalone change |
| --- | --- | --- |
| Root `package.json` `workspaces` | Includes `examples/infra-bridge` | Remove the workspace entry after extract |
| Root `package-lock.json` | Records `@brepjs/infra-bridge-example@0.0.0` | Generate a lockfile in this folder with `npm install` on Node 24 |
| `.github/workflows/ci.yml` | Path filter for `code` does **not** include `examples/`. No job runs `npm run check --workspace=@brepjs/infra-bridge-example` | Add a CI job here: Node 24, `npm ci`, `npm run check`. Optionally `preview` and `export:ifc` |
| `.github/actions/setup` | `npm ci` at repo root, WASM restore via `scripts/ensure-wasm.sh` | Standalone CI must install `occt-wasm` (and allow its install script) instead of the parent WASM helper |
| `.husky/pre-commit` | Root `typecheck` + `lint-staged`; skipped unless `src/` or `tests/` at **repo root** change | Own hooks, or a CI-only gate. Parent hook will not run this package's tests |
| `.lintstagedrc.json` | `src/**/*.ts` and `tests/**/*.ts` only — **no `*.tsx`** | If you keep lint-staged, include `src/**/*.{ts,tsx}` and `tests/**/*.{ts,tsx}` |
| Root `knip.config.ts` | No workspace entry for this package | Own knip config, or omit |
| `npm run check:infra-bridge-reference` | Lives on the parent; comparison is a sibling package | Keep reference comparison in the parent/reference repo, not in this package's default `check` |
| `reference/infra-bridge` | Depends on `@brepjs/infra-bridge-example` and imports `../../../examples/infra-bridge/src/...` from workbench/compare tsconfigs | Point those imports at the new package name/path, or at a published tarball |
| `tests/createBrepjs.test.ts` + `tests/fixtures/create-brepjs/bim-bridge-v1-baseline.json` | SHA-256 of this folder is part of the scaffolder contract | Update or drop that snapshot when the folder moves |
| Docs / ADRs | `docs/adr/0003-structure-the-bridge-as-owned-components.md`, `docs/infra-bridge-implementation-plan.md` describe `examples/infra-bridge/` | Update paths after extract |

## Minimum standalone `check` pipeline

Copy this into the new repo's CI once the missing files and published/packed libraries exist:

```sh
# Node >= 24
npm ci
npm run typecheck
npm run lint
npm run test
npm run preview
npm run export:ifc
```

Do **not** put `reference:compare` on that default path. It needs `reference/infra-bridge`, a checksummed Reference IFC (`tmp/Infra-Bridge.ifc` in the parent), and is intentionally separate from authored-source cleanliness.

## Current in-tree gate to fix before extract

`tests/projectionFallback.test.tsx` compares `projectInfraBridge()` to `familiesToBim()` on a non-nested civil slice. Workspace `familiesToBim()` now sets `compositionType: 'ELEMENT'` on the site; `src/projectInfraBridge.ts` `addSite(...)` does not. Align the fallback (and any other spatial adds) with `packages/brepjs-bim/src/familiesInfrastructureAdapter.ts` `projectedComposition()` before treating `npm run check` as green.
