# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、現在の作業状態だけを保ちます。

- Status: `ACTIVE`
- Current phase: `paper work order Phase 2 / Issue #41 printed-paper diagnosis isolated OCR confidence bottleneck; 2400px cap implemented`
- Current branch: `feat/paper-ocr-camera-robustness`
- Current PR: `#42 (Draft)`
- Last completed gate: `45/45 automated tests PASS; changed JS syntax checks PASS; git diff --check PASS; printed-paper diagnostic recorded; 2400px-cap verification PASS`
- Current blocker: `Printed fictional paper diagnostic: 9 raw lines / 1 line >=80 / 1 label hit before confidence filter / 0 after / 0 candidates. OCR confidence is the current bottleneck; 2400px-cap retest pending.`
- Next action: `Retest the same printed fictional sheet once with the 2400px preprocessing cap and ocrDebug=1; compare aggregate counts, then decide PR #42 direction.`
- PC-free work: `PR #42 current-head audit`
- PC-required work: `Printed-fictional-sheet iPad Safari diagnostic retest`
- User action required: `YES only for the prepared printed-fictional-sheet iPad retest`
- Merge authorized: `NO`
- Last updated: `2026-09-07`

## Optional short notes

- Issue #41 evidence: `docs/issue41-verification.md`.
- Aggregate diagnostics expose counts/booleans only; recognized text and candidate values are not shown or persisted.
- Parser constraints, approval/privacy behavior and confidence >=80 remain conservative.
- PR #42 remains Draft; merge is not authorized.

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- `PC-free work` と `PC-required work` は、現在の残件を実行環境で分けた短い一覧だけを持つ。ローカル実機確認が必要な作業を `PC-free work` に入れない。
- PC必須のBlockerがあっても、独立して安全に進められる `PC-free work` が残る場合は、プロジェクト全体を機械的に停止扱いにしない。
- PR、主要タスク、Blocker、merge状態、またはPC要否の分類が変わった時に更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
