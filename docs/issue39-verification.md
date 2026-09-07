# Issue #39 verification

## Automated checks

Run without Git or child-process test isolation in restricted environments:

```text
node --test --test-isolation=none tests/consumer-rules.test.js tests/paper-ocr.test.js tests/paper-ocr-ui.test.js tests/paper-ocr-runtime.test.js
```

The runtime integration uses the exact shipped browser worker, embedded WASM,
and Japanese model in an isolated JavaScript VM. The only fetch is mapped to
the local model file; storage access throws. It is actual OCR, but **not** a
browser or iPad Safari compatibility/performance result. UI tests execute the
application event handlers against fake controls, including cancellation,
replacement, timeout, approval invalidation, exact readback and failure.

Final automated result: 28 passed, 0 failed, 0 skipped (consumer rules 8,
OCR helpers/markup 11, single-intake UI/lifecycle 8, bundled runtime 1). The dynamic
Phase 1 panel is instantiated by the test DOM; duplicate IDs fail the test.
Reinitialization, original camera input markup, same preview URL, replacement
revocation, discard and page-end clearing are checked. No static intake remains.
The first isolated runner could not spawn children (EPERM); the same tests
ran with isolation disabled. One stale draft expectation for invalid image
selection was corrected to the original Phase 1 clearing behavior.

## Edge browser verification

Edge 152.0.4191.66 headless verification: PASS with the prepared synthetic PNG.
The browser was launched with external hostname resolution blocked and only
127.0.0.1 excluded. OCR still completed in 935 ms. The local server observed
only the bundled OCR worker, Tesseract worker, embedded-WASM core and Japanese
model for the OCR path. No CDN was required.

Before OCR, after OCR, and after approved copy, localStorage, sessionStorage,
IndexedDB and Cache Storage were all empty and unchanged. OCR completion left
the existing form unchanged until explicit approval; the resolved fictional
clinic name and delivery date then copied with exact readback while the preview
remained visible. This proves the browser-local path in Edge, not Safari.

## iPad Safari real-device verification — PASS

Date: 2026-09-07. Synthetic/non-sensitive data only. Safari version and exact OCR elapsed time were not recorded; OCR completed before the 120-second timeout.

- PASS: the temporary test URL opened on iPad Safari; the existing Phase 1 intake opened the camera, showed the captured preview/filename, and enabled local OCR.
- PASS: local OCR completed and displayed the four-field candidate review without visible layout breakage. In this photographed fixture all four OCR candidates were blank; this is acceptable fail-closed behavior and no value was guessed.
- PASS: switching to clinic input confirmed no destination field was changed before approval.
- PASS: a fictional manual candidate (テスト患者) was entered, explicitly approved, copied with the success/readback message, and the source image remained visible.
- PASS: a second OCR run could be cancelled while retaining the image; explicit discard cleared the image/candidates; reload did not restore temporary OCR data.
- Regression evidence for image replacement remains the prior Phase 1 iPad PASS plus the current automated stale-result/replacement test; this session did not repeat the unchanged replacement gesture separately.

Conclusion: the Issue #39 iPad Safari interaction/compatibility gate is PASS. Edge browser verification separately proves the local-only OCR asset path and no added browser persistence. Do not use the temporary Cloudflare test URL with real data; it was stopped after verification. Real-data use belongs only to the approved application deployment after merge.
