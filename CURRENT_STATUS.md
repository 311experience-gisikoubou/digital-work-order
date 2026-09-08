# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、現在の作業状態だけを保ちます。

- Status: `ACTIVE`
- Current phase: `merge authorization safety / Issue #53 implementation and final audit`
- Current branch: `chore/merge-authorization-gate`
- Current PR: `#54 (Ready)`
- Last completed gate: `PR #52 is already on main; Issue #53 merge-execution gate selftest PASS; existing authorization gate PASS; full Node suite 54/54 PASS; merged-PR live fail-closed check PASS; git diff --check PASS`
- Current blocker: `NONE`
- Next action: `final GitHub audit for PR #54, then explicit merge authorization`
- PC-free work: `PR #54 final GitHub audit / merge decision`
- PC-required work: `NONE`
- User action required: `YES（PR #54のmerge判断のみ。final audit NG時は不要）`
- Merge authorized: `NO`
- Last updated: `2026-09-08`

## Optional short notes

- PR #40 / Issue #39はmerge済み。ブラウザ内OCRは補助機能として維持する。
- PR #42 / Issue #41の精度改善実験はmergeせず終了。手入力を主経路とする。
- Issue #45は既存Object URLを再利用し、既存医院側フォームへ紙画像参照UIだけを追加する。
- 保存形式・PDF・歯式・clasp・drawing・collectFormData()は変更しない。
- PR #52 / Issue #50はmainに入った。並行コンテキストによる想定外state driftを検出したため、Issue #53でmerge実行ゲートを補強中。自動revertは行わない。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- `PC-free work` と `PC-required work` は、現在の残件を実行環境で分けた短い一覧だけを持つ。ローカル実機確認が必要な作業を `PC-free work` に入れない。
- PC必須のBlockerがあっても、独立して安全に進められる `PC-free work` が残る場合は、プロジェクト全体を機械的に停止扱いにしない。
- PR、主要タスク、Blocker、merge状態、またはPC要否の分類が変わった時に更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
