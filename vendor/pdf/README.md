# Local PDF assets

Issue #61 の iPad Safari 用固定寸法 PDF 生成で使用する同梱資産です。
実行時に CDN や外部 API から取得しません。

- `html2canvas-1.4.1.min.js`
  - upstream: `niklasvh/html2canvas` 1.4.1
  - license: MIT (`HTML2CANVAS-LICENSE`)
  - SHA-256: `e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb`
- `pdf-lib-1.17.1.min.js`
  - upstream: `Hopding/pdf-lib` 1.17.1
  - license: MIT (`PDF-LIB-LICENSE`)
  - SHA-256: `0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f`

用途は既存の印刷用 DOM をブラウザ内で画像化し、182×257mm の B5 または 210×297mm の A4 PDF へ配置することだけです。
患者・医院・受注情報を外部へ送信する機能はありません。