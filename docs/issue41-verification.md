# Issue #41 verification

Date: 2026-09-07.
Branch: `feat/paper-ocr-camera-robustness`.
PR: `#42 (Draft)`.
Merge authorized: NO. PREPARED_FOR_MERGE=no.

## Real-device evidence

Two iPad Safari camera-photo checks were completed using only the prepared fictional test sheet shown on a PC display.

1. Before preprocessing: all four OCR candidate fields were blank. Effectiveness: NG. Safety/fail-closed: PASS.
2. After preprocessing: all four OCR candidate fields were again blank. Effectiveness: NG. Safety/fail-closed: PASS.

In both runs, no incorrect candidate was automatically applied and human approval remained required.
No real patient, clinic or order data was used.

A third diagnostic check used a printed fictional sheet. It returned 9 raw OCR lines, 1 line with confidence >=80, 1 exact known-label hit before the confidence filter, 0 exact known-label hits after the filter, and 0 final candidates. All four candidate-present flags were false. Safety/fail-closed remained PASS. This isolates the current failure primarily to OCR confidence/recognition quality rather than the downstream exact-label/value parser.

## Forced reflection / current hypothesis

Two resolution interventions failed: parser robustness/synthetic coverage, then browser-local preprocessing.
The unresolved split is now observational:

- A: OCR raw output itself lacks recognizable labels/values.
- B: OCR produces usable text but confidence/exact-label/ambiguity/value validation rejects it.

## Implemented diagnostic route

`paper-ocr.js` keeps the existing single local OCR pass and now supports an opt-in aggregate diagnostic result.
`consumer-rules.js` shows the diagnostic surface only when the page is opened with `ocrDebug=1`.
Normal mode is unchanged.

The diagnostic exposes only:

- raw OCR line count;
- line count with confidence >= 80;
- exact known-label hit count before the confidence filter;
- exact known-label hit count after the confidence filter;
- final non-empty candidate count;
- per-field candidate-present booleans.

It never exposes recognized OCR text or candidate values.
Diagnostics are not stored in localStorage, sessionStorage, IndexedDB, Cache Storage, `state.orders`, logs, telemetry or an external service.
Diagnostics reset on a new OCR run, cancel, image replacement, explicit discard and pagehide/beforeunload through the existing lifecycle.

## OCR and preprocessing behavior retained

The existing parser still requires exact known labels plus colon, confidence >= 80, duplicate rejection including empty occurrences, complete valid dates and the existing four-field scope.
No fuzzy correction, label repair, value inference, threshold relaxation, automatic approval or additional OCR pass was added.

Preprocessing remains browser-local: createImageBitmap decode, bounded smoothing to a maximum 2400-pixel long edge without upscaling, white alpha composite, grayscale conversion and capped contrast normalization (gain <= 1.5). The 1600->2400 change is the single follow-up experiment justified by the printed-paper diagnostic; confidence >=80 remains unchanged. No thresholding or sharpening is used.
One temporary PNG is passed to one OCR run.
Bitmap, pixel-array, canvas and processed-Blob references are released through the existing cleanup paths; this is reference release, not a claim of physical secure erasure.

## Safety boundary

No external OCR or AI API, Firebase, runtime CDN, upload, telemetry or new network destination was added.
No new dependency was added.
No image/OCR/candidate persistence was added.
Human approval/readback and source-image retention/discard behavior remain unchanged.
PDF, tooth/clasp/drawing, calendar/fee logic, `collectFormData()` and `state.orders` were not changed.

## Automated verification

Commands:

```text
node --check consumer-rules.js
node --check paper-ocr.js
node --check tests/paper-ocr.test.js
node --check tests/paper-ocr-ui.test.js
node --test --test-isolation=none tests/consumer-rules.test.js tests/paper-ocr.test.js tests/paper-ocr-ui.test.js tests/paper-ocr-runtime.test.js
git diff --check
```

Result: 45 PASS / 0 FAIL / 0 skipped / 0 cancelled.

| Suite | Passed | Failed | Skipped/cancelled |
| --- | ---: | ---: | ---: |
| Consumer | 8 | 0 | 0 |
| OCR helper/markup/preprocessing/diagnostics | 22 | 0 | 0 |
| UI/lifecycle/diagnostic reset | 10 | 0 | 0 |
| Shipped runtime (parent + four subtests) | 5 | 0 | 0 |

Deterministic tests prove that diagnostic output contains no OCR text/candidate values, normal mode has no diagnostic UI, and lifecycle events clear diagnostic state.
Existing parser, privacy, approval, readback, rollback, timeout, replacement, discard and page-leave behavior remains PASS.

## Fictional runtime evidence and limitations

The shipped local worker/core/Japanese model still recovers the prepared synthetic and degraded fictional fixtures in automated tests.
This is not a camera/moire benchmark and does not prove real paper accuracy.

Host-side branch/scope/diff/security review and `git diff --check` are PASS on the current uncommitted head.
Current changed scope is limited to `consumer-rules.js`, `paper-ocr.js`, `tests/paper-ocr.test.js`, `tests/paper-ocr-ui.test.js`, this file, `docs/design.md` and `CURRENT_STATUS.md`.

## Remaining gate

The next observation is one iPad Safari diagnostic retest using a **printed fictional sheet**, not a monitor image, with `ocrDebug=1`.
Only aggregate diagnostic counts/booleans should be reported. Real patient/clinic/order data remains prohibited.
Issue #41 is not complete and this is not real-data readiness evidence.
PR #42 remains Draft. Merge authorized: NO.
