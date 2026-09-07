# Issue #41 verification

Date: 2026-09-07. Local workspace only.
Branch: `feat/paper-ocr-camera-robustness`, read directly from .git/HEAD.
PR #42 remains Draft by instruction; remote status was not queried.
Merge authorized: NO. PREPARED_FOR_MERGE=no.

## Real-device result supplied by the user

The first real iPad Safari camera-photo check on 2026-09-07 used only the
existing fictional test sheet. Camera effectiveness: NG; all four OCR candidate
fields were blank. Safety/fail-closed: PASS; no wrong candidate was inserted and
human approval remained required. This predates the preprocessing change below.
The changed implementation has not been verified on iPad Safari.
No uploaded screenshot or real patient/clinic data was opened or used as a fixture.

## Implementation

paper-ocr.js locally decodes the Blob with createImageBitmap, draws to an
unattached canvas with smoothing enabled / high quality, bounds its long edge
to 1600 pixels preserving aspect ratio without upscaling, composites transparency
on white and converts to grayscale. Contrast normalization stretches the observed
luminance range with gain capped at 1.5; ranges below 32 stay unchanged after
grayscale conversion. No thresholding or sharpening. One temporary PNG, one OCR pass.

Exact known labels plus colon, confidence >= 80, duplicate rejection including
empty occurrences, complete valid dates, four-field scope and no fuzzy correction
or inference are unchanged. Human approval/readback and the original File/preview/
Object URL lifecycle are unchanged. No consumer/application code was edited.
No threshold relaxation, fuzzy label repair, value inference, additional OCR pass,
upload, persistence, external OCR/AI/CDN/service or new dependency was introduced.

Bitmaps close, pixel arrays are zeroed, canvas dimensions reset to zero, and the
processed Blob reference is dropped after OCR. Worker termination also aborts
pending preprocessing; late decoded bitmaps close without OCR. The existing
cancel, replace and timeout paths can abort preprocessing and prevent late OCR.
The existing UI 120-second failure path still invalidates results, retains the original image
and terminates the worker. Decode/canvas/encoding failure rejects with no fallback.
Resource/reference release is not a guarantee of physical browser-memory erasure.

## Verification

```text
node --check paper-ocr.js
node --check tests/paper-ocr.test.js
node --check tests/paper-ocr-runtime.test.js
node --check tests/paper-ocr-ui.test.js
node --test --test-isolation=none tests/consumer-rules.test.js tests/paper-ocr.test.js tests/paper-ocr-ui.test.js tests/paper-ocr-runtime.test.js
```

Baseline: 34 passed, 0 failed/skipped/cancelled.
Final after updating the test harness: 42 PASS / 0 FAIL / 0 skipped / 0 cancelled.
Syntax checks: PASS for paper-ocr.js, tests/paper-ocr.test.js,
tests/paper-ocr-runtime.test.js and tests/paper-ocr-ui.test.js.

| Suite | Passed | Failed | Skipped/cancelled |
| --- | ---: | ---: | ---: |
| Consumer | 8 | 0 | 0 |
| OCR helper/markup/preprocessing | 21 | 0 | 0 |
| UI/lifecycle | 8 | 0 | 0 |
| Shipped runtime (parent + four subtests) | 5 | 0 | 0 |

An intermediate full run had 37 passes and 5 failures: four UI tests lacked the
new browser API stubs, and the new cancellation test did not await worker
registration. Updating the test harness and async wait resolved these failures
without changing approval/UI application code.

Deterministic coverage includes dimensions, grayscale/alpha/gain/flat images,
cleanup, decode/canvas/encoding failures, cancellation during decode/encoding,
late decoder completion and termination preventing late OCR. Existing parser,
privacy, approval, readback, rollback and lifecycle tests pass.

## Fictional runtime evidence and limitations

Only existing paper-order-synthetic.png, paper-order-camera-dim.png and
paper-order-camera-tilted.png fixtures were used. No fixture files were changed;
the recipe remains in tests/fixtures/README.md.

The VM executes the shipped worker/core/Japanese model using local file-backed
asset responses and storage traps, without a server or network. Added tests call
production recognize/preprocess. A fixture-only Node adapter uses built-in zlib
to decode existing RGBA PNGs and a BMP encoder to supply normalized pixels to OCR.
It substitutes for browser decoding, Canvas and PNG encoding. The derivatives are
already below the size bound, so these runtime tests do not exercise resampling.

Production preprocessing plus the shipped local OCR recovered all four exact
fictional fields from both retained degraded synthetic images, asserted by tests.
In the same run the original dim derivative recovered four fields; the
original tilted derivative recovered three, with patientName blank. This is
limited synthetic normalization evidence, not a camera/moire accuracy benchmark
or native-browser integration proof.
This synthetic success does NOT prove iPad Safari camera effectiveness;
a real-device camera retest is still required.

Headless Edge attempts exited without a usable automation response; native browser
execution is unavailable in this session. The dedicated temporary profile was
removed. No dependency was installed or security setting changed.

## Scope and gates

Product/test files from the preceding implementation (unchanged by this
documentation-only follow-up):

- paper-ocr.js
- tests/paper-ocr.test.js
- tests/paper-ocr-runtime.test.js
- tests/paper-ocr-ui.test.js

Only documents changed in this follow-up:

- docs/issue41-verification.md
- docs/design.md
- CURRENT_STATUS.md

Skills: preflight-audit, debug-verification, test-gate, final-pr-audit.
Operation preflight: PROCEED. Source review and privacy assertions found no new
persistence, network, upload, application-state, dependency or external-service
path. Preprocessing artifacts are temporary memory only. PDF, tooth/clasp/drawing,
calendar/fee logic, collectFormData and state.orders were not edited.

Git-dependent security-preflight, diff hygiene, complete working-tree/base/head
audit and Git-based history/stagnation checks were unrun because the user prohibited
Git commands. No new host-supervisor audit is claimed. No Git command, commit,
push, PR operation, merge, ExecutionPolicy Bypass or system security change occurred.
PR metadata/base/upstream/full diff remain UNKNOWN. No configured build/lint/
type-check/migration command applies; PDF/layout verification is unneeded.

Remaining UNKNOWN: native browser decoding/resampling/PNG integration, iPad Safari
compatibility/performance, actual camera effectiveness and moire reduction,
blur/perspective/handwriting recovery and real-device memory behavior after this
change. No new iPad check is claimed or requested in this local task.
Issue #41 is not complete; this is not real-data readiness evidence.

Next sequence: commit/push current changes, then the prepared iPad camera retest,
then final current-head audit. Commit/push and PR operations are outside this
documentation-only task. User action is not needed until the retest.
The verification results above are previously verified facts supplied by the user;
product tests were not rerun for this documentation-only follow-up.
PR #42 remains Draft; Merge authorized NO.
