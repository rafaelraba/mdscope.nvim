# Bundled browser dependencies

`dist/app.js` and `dist/mermaid.js` contain third-party packages. The complete upstream license and copyright texts for all 71 unique name@version packages in the esbuild input graphs are in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md). Ship both files with the bundles. The Mermaid bundle also links to `dist/mermaid.js.LEGAL.txt`, which must remain adjacent to it; esbuild currently emits no corresponding file for the app bundle.

To reproduce the inventory and full texts from the locked npm packages, run `npm ci` followed by `npm run build`. The generator at `scripts/generate-third-party-licenses.mjs` fails when a bundled package has no upstream license text. The project `LICENSE` applies only to original project code, not bundled dependencies.
