# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、製品・主要タスクの安定した現在地だけを保ちます。

- Status: `IDLE`
- Current phase: `primary completion criteria satisfied; maintenance/backlog only`
- Active product Issue: `NONE`
- Active product PR: `NONE`
- Last completed product work: `Issue #91: GitHub Pages aligned to current main and public runtime verified`
- Current blocker: `NONE`
- Next action: `no completion-blocking work; address B/C backlog only when an explicit business need appears`
- PC-free work: `maintenance/backlog only`
- PC-required work: `NONE`
- User action required: `NO`
- Merge authorized: `NO`
- Last product-state update: `2026-09-14`

## Optional short notes

- 完成条件と残件A〜F分類は `docs/completion-roadmap.md` を正本とする。Issue #91の公開入口検証まで完了し、現在確認済みの完成必須A項目は0件。
- `state.orders` is restored from same-tab `sessionStorage` only after strict validation; no long-term order persistence is added.
- 同一タブ再読み込みでは最後に開いていた `clinic` / `lab` 画面もallowlist検証後に復元する。不正値やstorage利用不可時は `clinic` へ戻す。
- 受注1件以上では画面内の一時受注警告を表示する。対応ブラウザでは `beforeunload` も有効化するが、iPad Safariでは標準ダイアログ表示を保証しない。
- 紙指示書はブラウザ内ローカルOCRを補助機能として維持し、紙画像を見ながらの手入力を主経路とする。
- OCR承認反映の4条件成立後だけ、一時画像を安全に自動破棄する。
- `workOrderRef` と納品アプリ取り込み用JSON exportは実装済み。外部クラウド送信は追加していない。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- docs-onlyのstatus同期Issue / branch / PR自身は、Current phaseやActive product Issue / PRへ記録しない。
- feature PR内で更新する場合は、そのPRの作業中状態ではなく、merge後に成立する製品状態を書く。
- exact main SHAを必須項目にしない。現在のmain SHAはGitで確認する。
- maintenance同期そのものをLast completed product workへ積み上げない。
- 製品・主要タスク、Blocker、PC要否の状態が変わった時だけ更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
