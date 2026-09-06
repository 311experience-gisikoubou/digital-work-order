# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、現在の作業状態だけを保ちます。

- Status: `ACTIVE`
- Current phase: `paper work order Phase 2 / Issue #37 final audit complete`
- Current branch: `design/paper-ocr-privacy-boundary`
- Current PR: `#38（Ready）`
- Last completed gate: `PR #38 final-pr-audit PASS; Ready for review`
- Current blocker: `NONE`
- Next action: `explicit merge authorization`
- PC-free work: `merge authorization待ち`
- PC-required work: `NONE`
- User action required: `YES（PR #38のmerge判断のみ）`
- Merge authorized: `NO`
- Last updated: `2026-09-07`

## Optional short notes

- PR #36はmerge済み。現在タスクはIssue #37のPhase 2設計のみ。OCR実装は後続Issue。
- 現在地点の正本は `CURRENT_STATUS.md`。`docs/session-handoff.md` は過去のhandoff文脈として保持し、現在地点の正本には使わない。
- 紙指示書画像取り込みPhase 1は一時プレビューのみ。OCR・データ化は別Phase。
- Foundation同期の証拠は同期PRに残し、statusへ詳細を複製しない。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- `PC-free work` と `PC-required work` は、現在の残件を実行環境で分けた短い一覧だけを持つ。ローカル実機確認が必要な作業を `PC-free work` に入れない。
- PC必須のBlockerがあっても、独立して安全に進められる `PC-free work` が残る場合は、プロジェクト全体を機械的に停止扱いにしない。
- PR、主要タスク、Blocker、merge状態、またはPC要否の分類が変わった時に更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
