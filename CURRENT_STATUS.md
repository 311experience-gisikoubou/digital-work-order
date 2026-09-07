# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、現在の作業状態だけを保ちます。

- Status: `ACTIVE`
- Current phase: `paper work order Phase 2 / Issue #41 local verification complete`
- Current branch: `feat/paper-ocr-camera-robustness`
- Current PR: `#42 (Draft)`
- Last completed gate: `Issue #41: 34 automated tests PASS / 0 FAIL / 0 skipped / 0 cancelled; 3 JS syntax checks PASS; host branch/scope/git diff --check audit PASS`
- Current blocker: `Actual iPad camera effectiveness unverified; PR #42 Draft`
- Next action: `prepare synthetic iPad camera verification ? 2 real-device checks ? final current-head audit`
- PC-free work: `Review docs/issue41-verification.md`
- PC-required work: `Issue #41 synthetic iPad camera verification (not started)`
- User action required: `NO for this local task`
- Merge authorized: `NO`
- Last updated: `2026-09-07`

## Optional short notes

- Issue #41 implementation, fixture recipe and local evidence: `docs/issue41-verification.md`.
- Parser constraints and approval/privacy behavior remain conservative; no real-data or camera success claim.
- No Git commands or PR operations were performed.

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- `PC-free work` と `PC-required work` は、現在の残件を実行環境で分けた短い一覧だけを持つ。ローカル実機確認が必要な作業を `PC-free work` に入れない。
- PC必須のBlockerがあっても、独立して安全に進められる `PC-free work` が残る場合は、プロジェクト全体を機械的に停止扱いにしない。
- PR、主要タスク、Blocker、merge状態、またはPC要否の分類が変わった時に更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
