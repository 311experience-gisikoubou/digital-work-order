# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、現在の作業状態だけを保ちます。

- Status: `ACTIVE`
- Current phase: `project status sync / Issue #75`
- Current branch: `chore/sync-current-status`
- Current PR: `#77 (Draft)`
- Base main: `d8206417aa478bf46dc30191a503cec1c20dfec7`
- Last completed work: `Issue #72 / PR #74 merged; temporary page-order loss warning verified on iPad Safari`
- Current blocker: `NONE`
- Next action: `docs-only PR #77 audit; then wait for explicit merge authorization`
- PC-free work: `PR #77 audit and merge decision`
- PC-required work: `NONE`
- User action required: `NO until merge decision`
- Merge authorized: `NO`
- Last updated: `2026-09-13`

## Optional short notes

- 現在の受注一覧は `state.orders` のページ内メモリのみ。再読み込み・タブ終了・ブラウザ終了で消える。
- 受注1件以上では画面内の一時受注警告を表示する。対応ブラウザでは `beforeunload` も有効化するが、iPad Safariでは標準ダイアログ表示を保証しない。
- 紙指示書はブラウザ内ローカルOCRを補助機能として維持し、紙画像を見ながらの手入力を主経路とする。
- OCR承認反映の4条件成立後だけ、一時画像を安全に自動破棄する。
- `workOrderRef` と納品アプリ取り込み用JSON exportは実装済み。外部クラウド送信は追加していない。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- `PC-free work` と `PC-required work` は、現在の残件を実行環境で分けた短い一覧だけを持つ。
- PR、主要タスク、Blocker、merge状態、またはPC要否の分類が変わった時に更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
