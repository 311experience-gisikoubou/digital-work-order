# App-local OCR assets

This directory contains only the static browser assets used by Issue #39.

| Component | Version / identity | License |
| --- | --- | --- |
| Tesseract.js (`tesseract.min.js`, `worker.min.js`) | 7.0.0 | Apache-2.0; `TESSERACT-JS-LICENSE` |
| Tesseract.js-core (`tesseract-core-lstm.wasm.js`) | 7.0.0 | Apache-2.0; `TESSERACT-CORE-LICENSE` |
| Japanese `tessdata_fast` (`jpn.traineddata.gz`) | SHA-256 `e70775956056759f2135c39dd64b6f7cdd9c13ee9995e8f0ca654d8d8385b492` | Apache-2.0; `TESSDATA-LICENSE` |

Public upstreams: [Tesseract.js](https://github.com/naptha/tesseract.js),
[Tesseract.js-core](https://github.com/naptha/tesseract.js-core),
[tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast),
[model license](https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE).
The supplied model has no independently verified upstream commit identifier;
the shipped compressed bytes are pinned by the hash above. Assets came from
the supervisor-approved public-dependency staging area, not from user data.
The model license was checked against the official Apache-2.0 text; the bundled
Apache-2.0 license text is supplied as `TESSDATA-LICENSE`.

Both minified bundle license notice files are retained. The runtime bundles
are unmodified. Their upstream CDN defaults are unreachable through the app's
explicit worker/core/language paths. `paper-ocr-worker.js` additionally restricts
worker fetch/import paths to the selected static assets and disables model
caching (`cacheMethod: 'none'` plus `cache: 'no-store'`).

The single non-SIMD LSTM core contains its WASM inline. No standalone WASM,
SIMD variants, tarballs, maps, package source trees, or unused languages are
shipped. Static assets must be served alongside the app, including under a
subdirectory; no runtime CDN dependency is required. Ordinary HTTP caching of
static JavaScript is not image/candidate persistence. No recurring service fee.

Updates are developer-owned: replace the pinned public assets and notices,
review license/network changes, run the synthetic tests, and repeat Safari
compatibility/performance verification. A failed asset load must remain an OCR
failure; never add a CDN fallback. Removal consists of removing this directory,
the paper OCR modules/UI, and their script tags; there is no service or stored
image/candidate database to migrate or clean up.
