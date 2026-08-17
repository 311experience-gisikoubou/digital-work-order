# Sync Log

このファイルは、共通基盤（`ai-dev-foundation`）からこのrepositoryへの手動同期記録です。1回の同期につき、1エントリを追記してください。

## Entry: Phase 3.5 sync (AGENTS.md + common skills)

- Target repository: `digital-work-order`
- Target branch: `chore/sync-ai-foundation-phase-3-5`
- Foundation version: `1.0.0-dev.3`
- Source repository: `ai-dev-foundation`
- Source commit SHA: `8e9e149a533046f082d6ea03e7819be129bb1e3f`（`main`、`learnings/`追加commit。`.agents/skills/`・`AGENTS.md`はこのcommit時点で`8083e0d`から変更なし）
- Synced date: `2026-08-17`
- Synced by: `Claude Code（Phase 3.5 是正作業の一環としての手動同期）`
- Synchronized files:
  - `AGENTS.md`
  - `.agents/skills/preflight-audit/SKILL.md`
  - `.agents/skills/test-gate/SKILL.md`
  - `.agents/skills/final-pr-audit/SKILL.md`
  - `.agents/skills/handoff/SKILL.md`
  - `.agents/skills/migration-safety/SKILL.md`
  - `.agents/skills/post-merge-verification/SKILL.md`
  - `.agents/skills/README.md`
  - `.claude/skills/preflight-audit/SKILL.md`
  - `.claude/skills/test-gate/SKILL.md`
  - `.claude/skills/final-pr-audit/SKILL.md`
  - `.claude/skills/handoff/SKILL.md`
  - `.claude/skills/migration-safety/SKILL.md`
  - `.claude/skills/post-merge-verification/SKILL.md`
- Repository-local, not synchronized from foundation (kept as-is):
  - `.agents/skills/manual-ui-smoke-test/SKILL.md`（repo固有skill本体。変更なし。同期前後でSHA256ハッシュ一致を確認済み）
  - `.claude/skills/manual-ui-smoke-test/SKILL.md`（repo固有wrapper。foundation側に対応するtemplateは存在しない。今回新設）
- Local deviations found before synchronization: 同期前の`AGENTS.md`は、foundationとは独立に手書きされた英語版であり、foundation正本とは構成・内容が全く異なっていた（一致行数0）。repository固有情報（役割分担・force push無条件禁止・独立第三者監査方針・学習文書の読了指示など）は、本同期に先立ち`AGENTS.local.md`側へ退避済み（Step 2・Step 4A-準備・A修正）。`.agents/skills/`配下の`preflight-audit`・`test-gate`・`final-pr-audit`・`handoff`の4件も、foundation非導入以前にdigital-work-order名指しで手書きされた独自版であり、同期元と内容が異なっていた（commit `cabdf25`で導入、Claude Codeの`.claude/skills/`からは一度も自動選択されていないことを事前調査済み）。`migration-safety`・`post-merge-verification`・`.agents/skills/README.md`は本repositoryに未導入だった（新規追加）。`.claude/skills/`はディレクトリ自体が存在しなかった（新規作成）。
- Verification performed: `git diff --check`（対象6ファイル、warning無し）。foundation正本6スキル本体との内容一致確認（`diff`、差分なし）。`.agents/skills/README.md`の内容一致確認（`diff`、差分なし）。`.claude/skills/`6件の参照path（`../../../.agents/skills/<name>/SKILL.md`）確認。`manual-ui-smoke-test`本体の同期前後SHA256一致確認（`dcd5db61...`で一致、変更なし）。secrets/token/個人情報キーワード検索（該当なし）。`docs/design.md`・application code（`app.js`等）の未変更確認。
- Resulting commit SHA: `not yet created`
- PR number: `not yet created`
- Rollback commit or rollback method: 本同期は独立した1commitとして作成する予定のため、問題が判明した場合は当該commitを`git revert`で取り消す。
- Notes: `.claude/skills/manual-ui-smoke-test/SKILL.md`はfoundation同期対象ではないrepository固有wrapperであり、将来のfoundation同期で上書き・削除してはならない（dentalの`merge-gate`と同種の扱い）。次回foundation側に新しい共通skillが追加された場合は、本ファイルへ新しいエントリを追記すること（既存エントリの書き換えはしない）。
