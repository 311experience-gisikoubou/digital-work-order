# Paper OCR synthetic fixture

`paper-order-synthetic.png` is an AI-prepared 1400 × 700 PNG, generated locally
with printed Japanese labels and entirely fictional values:

- 歯科医院名: 架空テスト歯科
- 担当歯科医師: 架空医師
- 患者名: 架空患者
- 納期: 2026/10/20

This is a non-sensitive mock paper work order, not a patient record. It is the
same fixture used by the real bundled worker/core/model integration test and
the prepared iPad Safari check. No human needs to type fixture data. It tests
clear printed text, not handwritten recognition quality or arbitrary layouts.

## Issue #41 derivation recipe

Use only `paper-order-synthetic.png` (1400 × 700) as the source.
This records the original System.Drawing operations without requiring a
committed generator executable or changing PowerShell execution policy.

1. Create a new 1050 × 525 bitmap (scale 0.75), clear it white, and select
   HighQualityBicubic interpolation.
2. Translate the origin to (525, 262.5). Rotate 0 degrees for
   `paper-order-camera-dim.png`, or +1 degree (clockwise in screen coordinates)
   for `paper-order-camera-tilted.png`.
3. Draw the source into rectangle (-525, -262.5, 1050, 525), clipping to the
   output bitmap. Exposed background remains white before shading.
4. For each output pixel (x, y), calculate
   `L = 0.299 * R + 0.587 * G + 0.114 * B`, then
   `gray = roundToEven(L * (0.65 + 0.15 * x / 1050) + 35)`.
   Set R, G and B to gray with opaque alpha. Rounding matches the original
   PowerShell integer conversion. No random input is used.
5. Encode a new PNG without copying source/device metadata. Rasterization
   and encoded bytes may vary by graphics library/version.

Both retained files were inspected: only IHDR, sRGB, gAMA, pHYs, IDAT and
IEND chunks are present, with no trailing bytes. Ancillary chunks describe
color rendering and pixel density; there are no text, EXIF, device, location
or timestamp chunks. Visible content is the fictional source data above.

These limited synthetic conditions do not establish iPad camera success,
blur, perspective or moire recovery.
