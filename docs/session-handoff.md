# Session Handoff

このファイルは、作業の「現在地点」を次の担当（AIまたは人間）に引き継ぐための文書である。
恒久仕様の正本ではない。業務・画面仕様の正本は `docs/design.md`、
恒久的な作業ルールの正本は `AGENTS.md` / `AGENTS.local.md` である。

このファイルは作業ごとに上書き更新してよい。

## 更新日時

- 2026-08-17

## 現在branch

- agent/add-learning-handoff-workflow

## 基準main SHA

- 8f231ebfdd411bdcfed16b773ecfe8675c0605a9

## 完了したこと

- main を origin/main（上記SHA）に最新化。
- 上記SHAから `agent/add-learning-handoff-workflow` ブランチを作成。
- `AGENTS.md` に最小追記（役割分担・既定フロー・NG/UNKNOWN時の停止・自動更新禁止の原則）。
- `docs/learnings.md` を新設し、今回の再発防止事項を記録。
- `docs/session-handoff.md`（本ファイル）を新設。

## 未完了

- commit / push / PR作成 / final-pr-audit。

## 確認済み

- 作業前の `git status` はクリーンであることを確認済み。
- `docs/design.md` に業務仕様の重複を追加していないことを確認済み（本作業は運用ルール文書のみ）。

## 未確認

- `preflight-audit` / `test-gate` / `final-pr-audit` 等のスキルは、
  `AGENTS.md` 記載の通り本リポジトリに未導入のため、実施は文書レベルの確認（`git diff --check` 等）に限定。

## 次の最小作業

- 変更差分の最終確認（`git diff --check` 等）。
- commit → push → PR作成。
- PR作成後、final-pr-audit相当の確認（現時点ではスキル未導入のため手動確認）。

## blocker

- なし。

## 実行担当

- 本セッション: Claude（ローカル実装・ローカルGit操作）。
- PR監査・merge管理: GPT（GitHub上）。
- merge実行・高リスク判断: 人間。

## 人間確認が必要な項目

- 本PRのmerge可否。
- `AGENTS.md` に追記した役割分担（Codex / GPT / Claude / 人間）の内容が実態と一致しているかの最終確認。
