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
- Resulting commit SHA: `cb6e4ab4969c5bc25f18a69695fda34b20999f68`
- PR number: `#6`
- Rollback commit or rollback method: 本同期は独立した1commitとして作成する予定のため、問題が判明した場合は当該commitを`git revert`で取り消す。
- Notes: `.claude/skills/manual-ui-smoke-test/SKILL.md`はfoundation同期対象ではないrepository固有wrapperであり、将来のfoundation同期で上書き・削除してはならない（dentalの`merge-gate`と同種の扱い）。次回foundation側に新しい共通skillが追加された場合は、本ファイルへ新しいエントリを追記すること（既存エントリの書き換えはしない）。（2026-08-18追記：上記2項目は当時未確定のまま放置されていたため、git historyから確認し確定値へ補完した。）

## Entry: Local AI Handoff adoption (local-ai-handoff skill + .ai-handoff/)

- Target repository: `digital-work-order`
- Target branch: `feature/local-ai-handoff-adoption`
- Foundation version: `1.0.0-dev.5`
- Source repository: `ai-dev-foundation`
- Source commit SHA: `2a2b7fb1c708356252abfa8a59772cb00dc0e097`（`main`、Local AI Handoff Foundation Support merge commit）
- Synced date: `2026-08-18`
- Synced by: `Claude Code（Local AI Handoff実証作業の一環としての手動同期）`
- Synchronized files:
  - `.agents/skills/local-ai-handoff/SKILL.md`
  - `.agents/skills/local-ai-handoff/detect-codex.ps1`
  - `.claude/skills/local-ai-handoff/SKILL.md`
- New repository-local files (from foundation template, not the skill canon itself):
  - `.ai-handoff/README.md`（`templates/.ai-handoff/README.md.template`から作成。digital-work-order固有の保護対象への言及を追記）
  - `.gitignore`（新設。`.ai-handoff/runtime/`を除外）
  - `.ai-handoff/runtime/{inbox,outbox,processed}/`（ローカルのみに作成。`.gitignore`により追跡対象外。このsync-logにも実データは記載しない）
- Local deviations found before synchronization: `local-ai-handoff`はdigital-work-order側に未導入だった（新規追加）。`.gitignore`自体がrepository全体で存在しなかった（新設）。
- Verification performed: foundation正本（`.agents/skills/local-ai-handoff/SKILL.md`・`detect-codex.ps1`）およびwrapper（`templates/.claude/skills/local-ai-handoff/SKILL.md.template`）との`diff`による内容完全一致確認。`git status`により`.ai-handoff/runtime/`が追跡対象外であることを確認。secrets/token/個人情報キーワード検索（該当なし）。アプリケーションコード・`docs/design.md`・localStorage・PDF・clasp・歯式・memoStrokes関連ファイルの未変更確認。
- Resulting commit SHA: `eef83750cad278280641b8dafb9060f1f856a05d`
- PR number: `#7`
- Rollback commit or rollback method: 本同期は独立した1commitとして作成する予定のため、問題が判明した場合は当該commitを`git revert`で取り消す。
- Notes: 実際のClaude→Codex→Claudeのdry-run実証（Codex CLIの実起動を含む）は、本sync（ファイル導入のみ）とは別に、明示確認のうえで実施した。dry-run結果はPR #7のConversationへ`[AI_HANDOFF]`として投稿済み（PASS）。

## Entry: Local AI Handoff V2 sync (automated duplicate/drift guards)

- Target repository: `digital-work-order`
- Target branch: `feature/local-ai-handoff-v2-guards`
- Foundation version: `1.0.0-dev.6`
- Source repository: `ai-dev-foundation`
- Source commit SHA: `200cbd780b9563a22715df0b15df17ff8563154c`（`main`、local-ai-handoff V2 merge commit）
- Synced date: `2026-08-18`
- Synced by: `Claude Code（Local AI Handoff V2作業の一環としての手動同期）`
- Synchronized files:
  - `.agents/skills/local-ai-handoff/SKILL.md`（更新：message_id／head_sha必須化、Automated Guards節追加）
  - `.agents/skills/local-ai-handoff/validate-handoff-message.ps1`（新規）
- Local deviations found before synchronization: なし（V1導入時と同じ経路での追加更新）。
- Verification performed: foundation正本（`SKILL.md`・`validate-handoff-message.ps1`）との`diff`による内容完全一致確認。secrets/token/個人情報キーワード検索（該当なし）。アプリケーションコード・`docs/design.md`の未変更確認。
- Resulting commit SHA: `fe91ef5`
- PR number: `#8`
- Rollback commit or rollback method: 本同期は独立した1commitとして作成する予定のため、問題が判明した場合は当該commitを`git revert`で取り消す。
- Notes: `.claude/skills/local-ai-handoff/SKILL.md`（wrapper）は今回変更なし（frontmatter・参照先とも既存のまま有効）。（2026-08-18追記：commit SHA・PR番号は当時未確定のまま放置されていたため、`git log`から確認し確定値へ補完した。）

## Entry: Local AI Handoff V2.1 sync (repository/branch drift guards)

- Target repository: `digital-work-order`
- Target branch: `feature/local-ai-handoff-v2.1-sync`
- Foundation version: `1.0.0-dev.7`
- Source repository: `ai-dev-foundation`
- Source commit SHA: `0ef76c0ae9e7960b54bc18e674f1025b722633c8`（`main`、local-ai-handoff V2.1 + [GPT_REVIEW]対応（owner/repo形式修正）merge commit）
- Synced date: `2026-08-18`
- Synced by: `Claude Code（Local AI Handoff V2.1横展開作業の一環としての手動同期）`
- Synchronized files:
  - `.agents/skills/local-ai-handoff/SKILL.md`（更新：repository drift・branch drift追加、必須フィールドにrepository・branch追加、repositoryはowner/repo形式）
  - `.agents/skills/local-ai-handoff/validate-handoff-message.ps1`（更新：上記2ガードを追加実装。exit code 6=repository drift、7=branch drift）
- Not changed: `.claude/skills/local-ai-handoff/SKILL.md`（wrapper）。frontmatter（name/description）はV2から変更なく、foundation側テンプレートと内容一致を確認済みのため今回は対象外。
- Local deviations found before synchronization: なし（V1/V2導入時と同じ経路での追加更新）。
- Verification performed: foundation正本（`SKILL.md`・`validate-handoff-message.ps1`）との`diff`による内容完全一致確認。wrapperがfoundationテンプレートと一致し変更不要であることを確認。secrets/token/個人情報キーワード検索（該当なし）。アプリケーションコード・`docs/design.md`の未変更確認。
- Resulting commit SHA: `e5a674d`
- PR number: `#9`
- Rollback commit or rollback method: 本同期は独立した1commitとして作成する予定のため、問題が判明した場合は当該commitを`git revert`で取り消す。
- Notes: V2.1で追加された`repository`・`branch`必須フィールドにより、V2時点で作成済みの（もしあれば）未処理メッセージは新validatorで`exit 3`（フィールド欠落）になる。現時点で`.ai-handoff/runtime/inbox/`・`outbox/`に未処理メッセージが無いことを確認済み（`processed/`のみ、過去のdry-run記録）。（2026-08-18追記：commit SHA・PR番号は当時未確定のまま放置されていたため、`git log`から確認し確定値へ補完した。）

## Entry: Local AI Handoff V3 sync (orchestration script + detect-codex.ps1 fix)

- Target repository: `digital-work-order`
- Target branch: `feature/local-ai-handoff-v3-sync`
- Foundation version: `1.0.0-dev.8`
- Source repository: `ai-dev-foundation`
- Source commit SHA: `e61527da466117132cc456c6feb822818b246d49`（`main`、local-ai-handoff V3（run-codex-handoff.ps1オーケストレーション＋detect-codex.ps1のWrite-Error修正）merge commit）
- Synced date: `2026-08-18`
- Synced by: `Claude Code（Local AI Handoff V3横展開作業の一環としての手動同期）`
- Synchronized files:
  - `.agents/skills/local-ai-handoff/SKILL.md`（更新：「Orchestration (V3)」節を追加）
  - `.agents/skills/local-ai-handoff/detect-codex.ps1`（更新：`Write-Error`を`[Console]::Error.WriteLine`＋明示的`exit 1`へ修正。V3実装中に発覚した、`$ErrorActionPreference = 'Stop'`と組み合わさると自身の`exit 1`を迂回して例外が伝播するバグの修正）
  - `.agents/skills/local-ai-handoff/run-codex-handoff.ps1`（新規：validate→detect→`codex exec -s read-only`起動→出力保存→結果確認、の7ステップを1コマンドにまとめたオーケストレーションスクリプト。`outbox`/`inbox`/`processed`間のファイル移動は行わない。sandboxモード変更・approval bypassのパラメータは存在しない）
- Not changed: `.claude/skills/local-ai-handoff/SKILL.md`（wrapper）。foundation側テンプレート（`templates/.claude/skills/local-ai-handoff/SKILL.md.template`）と`diff`一致を確認済みのため今回は対象外。`.agents/skills/local-ai-handoff/validate-handoff-message.ps1`もfoundation正本と`diff`一致を確認済みのため今回は対象外（V2.1から変更なし）。
- Local deviations found before synchronization: なし（V1/V2/V2.1導入時と同じ経路での追加更新）。
- Verification performed: foundation正本4ファイル（`SKILL.md`・`detect-codex.ps1`・`run-codex-handoff.ps1`・`validate-handoff-message.ps1`）との`diff`による内容完全一致確認（前者3件は更新、`validate-handoff-message.ps1`は変更なしを確認）。wrapperがfoundationテンプレートと一致し変更不要であることを確認。secrets/token/個人情報キーワード検索（該当なし）。アプリケーションコード・`docs/design.md`の未変更確認。
- Resulting commit SHA: `not yet created`
- PR number: `not yet created`
- Rollback commit or rollback method: 本同期は独立した1commitとして作成する予定のため、問題が判明した場合は当該commitを`git revert`で取り消す。
- Notes: `run-codex-handoff.ps1`は既存の手動ステップ（validate実行→Codex検出→`codex exec`起動→出力確認）を1コマンドにまとめたものであり、権限や自律範囲を追加するものではない（foundation側`CHANGELOG.md` 1.0.0-dev.8参照）。Human Confirmation Pointsは変更なし。

## Entry: Full common-rule resync to v1.0.0-dev.20

- Target repository: `digital-work-order`
- Target branch: `chore/sync-ai-dev-foundation-dev20`
- Foundation version: `1.0.0-dev.20`
- Source repository: `ai-dev-foundation`
- Source commit SHA: `c296142882a90a627e4142e187363861478997bb`
- Synced date: `2026-08-31`
- Synced by: `ChatGPT（GitHub connectorによるremote-only手動同期）`
- Synchronized files:
  - `AGENTS.md`
  - `.agents/skills/README.md`
  - `.agents/skills/common-rule-integration-audit/SKILL.md`
  - `.agents/skills/preflight-audit/SKILL.md`
  - `.agents/skills/preflight-audit/operation-preflight.mjs`
  - `.agents/skills/preflight-audit/operation-preflight-selftest.mjs`
  - `.agents/skills/preflight-audit/security-preflight.mjs`
  - `.agents/skills/preflight-audit/security-preflight-selftest.mjs`
  - `.agents/skills/preflight-audit/security-history-audit.mjs`
  - `.agents/skills/preflight-audit/security-history-audit-selftest.mjs`
  - `.agents/skills/test-gate/SKILL.md`
  - `.agents/skills/final-pr-audit/SKILL.md`
- Existing current common files intentionally unchanged: `handoff` / `local-ai-handoff` / `migration-safety` / `post-merge-verification` はfoundation正本と一致していたため変更しない。
- Repository-local files preserved: `AGENTS.local.md`、`.agents/skills/manual-ui-smoke-test/`、`.agents/skills/debug-verification/`、repository固有wrapper/運用を変更しない。
- Excluded foundation files: `CORE.md` / `OPERATIONS.md` / `PROJECT_COMPLETION.md` / `VERSION` / `roles/` / `learnings/` / `templates/` はapplication同期対象外としてコピーしない。
- Application scope preserved: `docs/design.md` / application code / PDF / localStorage / clasp / handwriting / tooth-chart / dependency files / data paths は変更しない。
- Verification performed: source version/SHA固定、base=`main` SHA `ca18937aed494fae6f1494abbd77c25f558679a7`からfeature branch作成、merge-base=base・behind_by=0、preflight配下7ファイルを含む同期対象のcanonical blob一致を確認。foundation source headで3 selftest PASS済み。PR exact-headの最終remote diff/mergeability/review/CI監査はmerge前に実施する。
- Resulting commit SHA: `pending squash merge`
- PR number: `#17`
- Rollback commit or rollback method: 問題が判明した場合はPR #17のsquash commitを通常の`git revert`で取り消す。
- Notes: remote-only同期。実データへのアクセス、外部サービス追加、アプリのデータ経路変更は行っていない。mergeは別工程であり、人間の明示承認前には実行しない。

## Entry: Full common-rule resync to v1.0.0-dev.29

- Target repository: `digital-work-order`
- Target branch: `chore/foundation-dev29-current-status`
- Foundation version: `1.0.0-dev.29`
- Source repository: `ai-dev-foundation`
- Source commit SHA: `d5eefabe03a83c4545b1c811fbad98b11d95ba97`
- Synced date: `2026-09-03`
- Synced by: `ChatGPT（GitHub connectorによるremote-only完全同期）`
- Canonical shared surface: `AGENTS.md` + foundation `.agents/skills/` 全26ファイル。
- Foundation sync audit equivalent: exact `AGENTS.md` blob and all shared skill trees/files match the fixed foundation source; missing=0 / stale=0.
- Repository-local files preserved: `.agents/skills/debug-verification/`、`.agents/skills/manual-ui-smoke-test/`、`AGENTS.local.md`、local wrappers/settings。
- Current status adoption: root `CURRENT_STATUS.md` を導入。`docs/session-handoff.md` は過去記録であり現在地点の正本とはしない。
- Application scope preserved: `docs/design.md`、application HTML/CSS/JavaScript、PDF/print、localStorage、clasp、handwriting、tooth-chart、dependency/data pathsは変更しない。
- PR number: `#19`
- Rollback: 問題が判明した場合はPR #19のsquash commitを通常の`git revert`で取り消す。
- Notes: application build/test/REAL_DEVICEはgovernance-only exact-copy同期のため不要。mergeは人間の明示承認前には実行しない。

## Entry: Effective skill sync to v1.0.0-dev.30

- Target repository: `digital-work-order`
- Target branch: `chore/foundation-dev30-effective-skill-sync`
- Foundation version: `1.0.0-dev.30`
- Source repository: `ai-dev-foundation`
- Source commit SHA: `e4f0520cfeab21c086cc817c3ce33bda3b2841ea`
- Synced date: `2026-09-03`
- Synced by: `ChatGPT（GitHub connectorによるremote-only実効同期）`
- Canonical surface: `AGENTS.md` + foundation `.agents/skills/` の全共有ファイルを固定SHAで比較する。
- Native adapter surface: Claude Code利用repositoryのため、foundation `templates/.claude/skills/*/SKILL.md.template` と `.claude/skills/<skill>/SKILL.md` も完全同期条件とする。
- Files updated: `.agents/skills/README.md`、`common-rule-integration-audit/SKILL.md`、`foundation-sync-audit` のSKILL/gate/selftest、Claude wrapperの `common-rule-integration-audit` / `foundation-sync-audit` 追加、`preflight-audit` / `final-pr-audit` 更新。
- Repository-local extras preserved: `.agents/skills/debug-verification/`、`.agents/skills/manual-ui-smoke-test/`、`.claude/skills/debug-verification/`、`.claude/skills/manual-ui-smoke-test/` はfoundation対象外extraとして保持する。
- Application scope preserved: `docs/design.md`、application HTML/CSS/JavaScript、PDF/print、localStorage、clasp、handwriting、tooth-chart、dependency/data pathsは変更しない。
- Verification: PR作成前の固定SHA remote auditでcanonical missing/staleとClaude wrapper missing/staleを0件にする。最終結果はPR exact headで再監査する。
- PR number: `pending creation`。
- Rollback: 本同期PRのsquash commitを通常の`git revert`で取り消す。

## 2026-09-04 — ai-dev-foundation 1.0.0-dev.37

- Source commit: `e45cd1b3e961e9ca2f99d626248f2eefa611b748`
- Sync: `AGENTS.md` + canonical `.agents/skills/` changed surface
- Method: fail-closed dev.35 → dev.37 remote-only update
- Verification: exact canonical blob identity + stagnation selftest
