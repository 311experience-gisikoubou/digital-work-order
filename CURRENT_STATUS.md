# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、現在の作業状態だけを保ちます。

- Status: `ACTIVE`
- Project: `311experience-gisikoubou/digital-work-order`
- Project boundary: `デジタル歯科技工指示書専用。dental-delivery-billing は別Repoであり、このプロジェクトでは実装・PR・実機確認を行わない。`
- Current phase: `Issue #61 / iPad Safari JIS B5 print size mismatch`
- Current branch: `chore/refresh-current-status-dwo`
- Current PR: `#60 (Draft)`
- Latest main: `c7c8f7cf853ee16818042ab3054bb64b8cfca796`
- Last completed gate: `PR #59 Foundation dev.67 sync merged`
- Last completed product work: `PR #52 納品連携JSON export merged`
- Open product issues: `1 (#61)`
- Open PRs: `0`
- Current blocker: `NONE`
- Next action: `PR #60をmerge後、Issue #61の再現→原因特定→最小修正へ進む`
- PC-free work: `Issue #61のprint CSS /既存テスト経路の診断`
- PC-required work: `Issue #61の最終iPad Safari REAL_DEVICE確認`
- User action required: `YES（PR #60のmerge判断のみ）`
- Merge authorized: `NO`
- Last updated: `2026-09-10`

## Optional short notes

- PR #40 / Issue #39: ブラウザ内OCRは補助機能としてmerge済み。
- PR #42 / Issue #41: OCR精度改善実験はmergeせず終了。紙画像を見ながらの手入力を主経路とする。
- PR #47 / Issue #45: 紙画像を見ながら既存フォームへ入力するUIをmerge済み。
- PR #49 / Issue #46: stable `workOrderRef` をmerge済み。
- PR #52 / Issue #50: versioned delivery-intake JSON exportをmerge済み。受信側アプリの実装はこのRepoの対象外。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- `PC-free work` と `PC-required work` は、現在の残件を実行環境で分けた短い一覧だけを持つ。ローカル実機確認が必要な作業を `PC-free work` に入れない。
- PC必須のBlockerがあっても、独立して安全に進められる `PC-free work` が残る場合は、プロジェクト全体を機械的に停止扱いにしない。
- PR、主要タスク、Blocker、merge状態、またはPC要否の分類が変わった時に更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
