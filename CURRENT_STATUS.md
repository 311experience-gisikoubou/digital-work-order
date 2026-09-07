# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、現在の作業状態だけを保ちます。

- Status: `ACTIVE`
- Current phase: `paper work order Phase 2 / Issue #39 browser verification complete; iPad Safari pending`
- Current branch: `feat/paper-ocr-four-field-candidates`
- Current PR: `Issue #39 PR not created in this run; host supervisor owns Git/PR metadata`
- Last completed gate: `28 automated tests PASS; Edge 152 synthetic browser OCR/network/storage check PASS`
- Current blocker: `iPad Safari compatibility/performance/layout remains unverified; real-data use remains blocked`
- Next action: `final Git audit → commit/push → Draft PR → prepared synthetic iPad Safari checks`
- PC-free work: `GitHub PR/final audit after push`
- PC-required work: `prepared synthetic iPad Safari checks (4)`
- User action required: `NO until AI prepares the iPad test environment; then 4 short Safari checks`
- Merge authorized: `NO`
- Last updated: `2026-09-07`

## Optional short notes

- Issue #39の対象は一時画像→ローカルOCR→4項目候補→明示承認→フォームコピー/照合。実データ利用・画像自動破棄は未承認/未実装。
- 現在地点の正本は `CURRENT_STATUS.md`。`docs/session-handoff.md` は過去のhandoff文脈として保持し、現在地点の正本には使わない。
- 今回の実装・検証の詳細は `docs/issue39-verification.md`。Git操作とPR作成はSupervisorへ委任済み。
- Foundation同期の証拠は同期PRに残し、statusへ詳細を複製しない。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- `PC-free work` と `PC-required work` は、現在の残件を実行環境で分けた短い一覧だけを持つ。ローカル実機確認が必要な作業を `PC-free work` に入れない。
- PC必須のBlockerがあっても、独立して安全に進められる `PC-free work` が残る場合は、プロジェクト全体を機械的に停止扱いにしない。
- PR、主要タスク、Blocker、merge状態、またはPC要否の分類が変わった時に更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
