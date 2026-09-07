# Issue #41 verification

Date: 2026-09-07. Local workspace only.
Branch: `feat/paper-ocr-camera-robustness`, read directly from .git/HEAD.
No Git commands were run; base SHA, complete working-tree diff, upstream and
PR state were not audited. No PR number is assigned in this record.

## Verified implementation

The existing conservative parser improvement is retained: spaces/tabs between
characters of exact approved labels; CR, CRLF, LF, U+2028 and U+2029 boundaries.
Explicit known label plus colon remains mandatory. Misspellings are not repaired;
names and dates are not inferred. Empty labeled occurrences count toward duplicate
rejection. Recognition still includes only lines with confidence >= 80.

No OCR preprocessing, configuration, runtime paths, dependencies, approval,
readback or image lifecycle implementation was changed in this continuation.

## Local verification

Commands:

```text
node --check paper-ocr.js
node --check tests/paper-ocr.test.js
node --check tests/paper-ocr-runtime.test.js
node --test --test-isolation=none tests/consumer-rules.test.js tests/paper-ocr.test.js tests/paper-ocr-ui.test.js tests/paper-ocr-runtime.test.js
```

Final result, verified by the host supervisor: 34 passed, 0 failed, 0 skipped, 0 cancelled.
Consumer: 8; OCR helper/markup: 15; UI/lifecycle: 8;
shipped runtime: 3 (parent and two derivative subtests).
Syntax checks: 3 succeeded, also verified by the host supervisor. No failing test run in this continuation.
An initial write corrupted newly added Japanese test strings through the default
PowerShell pipe encoding; source inspection caught it. ASCII-escaped transfer
corrected the strings and the complete checks above were rerun successfully.
The initial green run is not the final verification evidence.

Tests cover spaced labels, every supported separator, fuzzy/misspelled labels,
missing labels/colons, repeated equal/different/empty values, ambiguous dates,
confidence 80 acceptance and 79.99 rejection, explicit approval, readback,
rollback and existing privacy/lifecycle behavior.

Both synthetic derivatives recovered clinicName = 架空テスト歯科 and
deliveryDate = 2026-10-20 using the shipped worker/core/Japanese model.
Doctor/patient assertions permit only the exact fictional value or blank.
The VM uses local file-backed asset responses with no server/network, rejects
unexpected paths, and throws on storage access. It is not browser/Safari evidence.

## Fixtures and scope

The static derivatives are retained. The deterministic
source/scale/rotation/grayscale/shading/rounding transformation recipe is
documented in `tests/fixtures/README.md`; no generator executable is committed.
The host supervisor confirmed removal of `tests/fixtures/derive-camera-fixtures.ps1`.

Both retained PNGs are 1050 x 525. Visual inspection shows fictional source
content only. Chunk inspection found IHDR, sRGB, gAMA, pHYs, IDAT, IEND and no
trailing bytes: rendering/density information only, no text/EXIF/device/location
or timestamp metadata. PNG bytes were not changed.

Files edited in this continuation: tests/paper-ocr.test.js,
tests/fixtures/README.md, docs/design.md, docs/issue41-verification.md,
CURRENT_STATUS.md; the specified generator was deleted. Existing paper-ocr.js
and tests/paper-ocr-runtime.test.js improvements were retained and verified.
Host supervisor reviewed the complete Git changed-file scope; no unrelated file was found.

## Gates and limits

Skills: preflight-audit, debug-verification, test-gate, final-pr-audit.
Operation preflight: PROCEED. Source/privacy and test review: local PASS.
Codex-side Git-dependent gates were intentionally left to the host supervisor. The host
supervisor verified branch/base alignment, complete changed-file scope and literal
`git diff --check`: PASS. Historical/stagnation audits were not rerun for this parser-only change.
PR/merge readiness: not assessed;
PREPARED_FOR_MERGE=no. No Git commands, commit, push, PR creation or merge.
No dependency installation or new external network/runtime path.

No configured build/lint/type-check/migration command applies; node --check
and the requested existing suites were run. PDF/layout checks are unneeded
for this parser-only scope. Issue #41 iPad camera verification remains unrun.
Synthetic derivatives establish acceptance coverage, not measured camera
accuracy improvement. Blur, perspective, moire, handwriting and actual iPad
camera recovery remain UNKNOWN. Issue #39 device results are not Issue #41 evidence.
