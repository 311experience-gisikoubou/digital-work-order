# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、現在の作業状態だけを保ちます。

- Status: `ACTIVE`
- Current phase: `maintenance / current-state cleanup`
- Current branch: `main`
- Current PR: `N/A`
- Last completed gate: `Foundation dev.40 sync PR #27 post-merge PASS`
- Current blocker: `NONE`
- Next action: `Issue #12を現行のCURRENT_STATUS正本運用と照合し、obsolete/closeまたは最小更新を判定する`
- PC-free work: `Issue #12の現行ルール照合・整理; 次のproduct backlog/spec監査`
- PC-required work: `NONE（新しいUI/PDF/Apple Pencil変更を開始するまでは不要）`
- User action required: `NO`
- Merge authorized: `NO`
- Last updated: `2026-09-05`

## Optional short notes

- 現在、open product PRはない。
- `docs/session-handoff.md` は過去セッション記録であり、現在地点の正本は `CURRENT_STATUS.md`。Issue #12はこの後の運用変更より前の内容を含むため再監査対象。
- Foundation同期の証拠は同期PRに残し、statusへ詳細を複製しない。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- `PC-free work` と `PC-required work` は、現在の残件を実行環境で分けた短い一覧だけを持つ。ローカル実機確認が必要な作業を `PC-free work` に入れない。
- PC必須のBlockerがあっても、独立して安全に進められる `PC-free work` が残る場合は、プロジェクト全体を機械的に停止扱いにしない。
- PR、主要タスク、Blocker、merge状態、またはPC要否の分類が変わった時に更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
