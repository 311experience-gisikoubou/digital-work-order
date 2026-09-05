# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、現在の作業状態だけを保ちます。

- Status: `ACTIVE`
- Current phase: `maintenance / backlog selection`
- Current branch: `main`
- Current PR: `N/A`
- Last completed gate: `Foundation dev.42 sync PR #31 post-merge PASS`
- Current blocker: `NONE`
- Next action: `product backlog / docs/design.md を監査し、次の最優先製品タスクを1件選ぶ`
- PC-free work: `product backlog / 仕様監査; 次タスクのIssue化・優先順位付け`
- PC-required work: `NONE（新しいUI/PDF/Apple Pencil変更を開始するまでは不要）`
- User action required: `NO`
- Merge authorized: `NO`
- Last updated: `2026-09-06`

## Optional short notes

- 現在、open product PRはない。
- 現在地点の正本は `CURRENT_STATUS.md`。`docs/session-handoff.md` は過去のhandoff文脈として保持し、現在地点の正本には使わない。
- Issue #12の「単一current-state checkpoint」という目的は `CURRENT_STATUS.md` 運用で満たす。残存していた開始時参照の不整合を今回の保守PRで解消し、merge時にIssue #12をcloseする。
- Foundation同期の証拠は同期PRに残し、statusへ詳細を複製しない。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- `PC-free work` と `PC-required work` は、現在の残件を実行環境で分けた短い一覧だけを持つ。ローカル実機確認が必要な作業を `PC-free work` に入れない。
- PC必須のBlockerがあっても、独立して安全に進められる `PC-free work` が残る場合は、プロジェクト全体を機械的に停止扱いにしない。
- PR、主要タスク、Blocker、merge状態、またはPC要否の分類が変わった時に更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
