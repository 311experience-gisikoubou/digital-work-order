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

## Prepared iPad Safari checks — not started

Estimated human time: 5 minutes. Fixed total: 4 checks; completed: 0; remaining:
4. Use only `tests/fixtures/paper-order-synthetic.png` in an approved synthetic
test deployment. The deployment/device has not been verified in this run;
do not start until the AI/supervisor verifies that environment and makes the
fixture available for selection. No sample-data typing is required.

1. In 「受注管理」, press 「紙指示書を取り込む」 and select the prepared PNG.
   Confirm the preview is readable and the four-field review fits the iPad
   screen after pressing 「端末内で読み取る」. Record device/Safari version and
   elapsed OCR time; it must finish before the 120-second timeout.
2. Compare candidates to the visible image. Confirm OCR completion does not
   fill the existing clinic form. Select 「歯科医院名を承認」 and 「納期を承認」,
   then 「選択した候補を承認してフォームへ反映」. Confirm the readback message
   matches those values and the image remains visible. The order is not saved
   or submitted. Calendar calculation/display is not refreshed by OCR copy.
   The VM fixture currently resolves clinicName and deliveryDate; doctorName
   and patientName remain blank. Do not approve blank or incorrect candidates.
   If Safari resolves different fields, record that result and keep this check
   unconfirmed rather than guessing values or improvising sample data.
3. Read the same fixture again, then 「候補確認をキャンセル」. Confirm review
   closes and the preview remains. Repeat image selection and confirm the new
   preview replaces the old one. Check that buttons are comfortable to tap.
4. Switch between clinic and lab views, then 「画像を破棄」. Confirm the image
   and candidate fields clear. Reload and confirm temporary OCR data does not
   return. Existing clinic manual entry remains usable.

Purpose: Edge browser execution confirms the local worker/WASM path and non-persistence boundary, but Safari worker/WASM/image-decoding compatibility, timing, touch and visible layout still require iPad confirmation. Technical network/storage diagnosis remains AI-owned. Real-data readiness remains blocked until the prepared iPad verification is complete.
