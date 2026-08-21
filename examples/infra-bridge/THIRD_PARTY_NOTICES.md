# Third-party notices

This project uses the following direct runtime dependencies. Exact resolved dependency trees are recorded in `package-lock.json`.

| Component                                    | Source/package version | License           |
| -------------------------------------------- | ---------------------: | ----------------- |
| `brepjs` workspace snapshot                  |               18.150.1 | Apache-2.0        |
| `brepjs-bim` workspace snapshot              |                 0.16.1 | Apache-2.0        |
| `brepjs-families` workspace snapshot         |                  0.7.0 | MIT               |
| `occt-wasm` tooling and wrapper              |                  4.2.0 | MIT OR Apache-2.0 |
| Open Cascade WASM distributed by `occt-wasm` |       bundled by 4.2.0 | LGPL-2.1-only     |
| `web-ifc`                                    |                 0.0.77 | MPL-2.0           |
| `zod`                                        |                  4.4.3 | MIT               |

The three brepjs platform packages are immutable workspace snapshots, not public release artifacts. Their source repository, source commit, filenames, internal package versions, SHA-256 digests, and npm-registry comparison at freeze time are recorded in `vendor/manifest.json`; license files included by the packages remain inside the tarballs.

The Open Cascade WASM licensing distinction is documented by `occt-wasm`: its tooling and TypeScript wrapper use MIT OR Apache-2.0, while the compiled Open Cascade WASM uses LGPL-2.1-only. Consumers distributing the WASM must preserve the ability to replace the LGPL component and comply with its license.

The minimal OpenType font embedded in `src/fonts/projectFont.ts` is a project-owned asset, not a third-party font.

This notice is informational and does not replace the license texts shipped by each dependency.
