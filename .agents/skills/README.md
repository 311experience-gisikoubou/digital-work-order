# .agents/skills/

このディレクトリは、この共通基盤repositoryが正本として持つ共通スキル（`SKILL.md`）の置き場所です。

## 現在の状態

共通開発フロー用スキルに加えて、共通ルール変更前の強制ゲート`common-rule-integration-audit`と、application repositoryへの同期実効性を確認する`foundation-sync-audit`を持ちます。技術スタック固有の手順は各アプリケーションrepository側の`AGENTS.local.md`を参照します。

## 完全共通（A分類・技術固有部分を含まない）

- **`common-rule-integration-audit`**：共通ルール・共通スキル・共通学習を追加/変更する前に必ず実行する強制ゲート。既存正本との重複・類似・矛盾・陳腐化・scope・統合可能性を確認し、`MERGE_EXISTING` / `NEW_COMMON` / `LOCAL_ONLY` / `REJECT` / `HUMAN_DECISION`へ分類する。正本変更は人間承認後のみ。
- **`foundation-sync-audit`**：application repositoryへ同期した`AGENTS.md`とfoundation側`.agents/skills/`の全共有ファイルを、実ファイルの同一性で確認する強制監査。欠落・古い共有ファイルは`STOP`とし、version表記・sync log・`AGENTS.md`一致だけで「完全同期済み」と判定しない。部分同期は部分同期として扱い、remote-onlyでは固定SHA間のblob/content比較を同等証拠として使う。
- **`preflight-audit`**：実装・修正・リファクタリング前のGit状態・仕様・既存コード・テストの確認と、想定外差分・仕様矛盾・データ損失リスク・追加費用リスクでの停止。
- **`post-merge-verification`**：GitHub上でPRがマージされた後の、マージ方式（squash／merge commit／rebase merge）確認、tree一致確認、local `main`のfast-forward同期、branch削除の安全判断。
- **`handoff`**：作業を別のチャット・別のAI・別のセッションへ引き継ぐための、paste-ready Markdown形式での状況整理。

## 共通本体＋アプリ側設定（B分類・技術スタック固有部分を分離）

- **`migration-safety`**：既存migrationの不変性、番号・順序確認、fresh適用／既存DBからのupgrade確認、schema整合性確認、data loss防止、backup・rollbackの判断という共通原則のみを持つ。具体的なDB製品名・migrationツール名・コマンドは含まず、各アプリケーション側の`AGENTS.local.md`を参照する。
- **`test-gate`**：変更種別に応じた検証選択、軽い検証から重い検証への順序、失敗時停止、検証結果の状態記録という共通ワークフローのみを持つ。具体的な実行コマンドは含まず、各アプリケーション側の`AGENTS.local.md`を参照する。
- **`final-pr-audit`**：base/head SHA・commit数・変更ファイル・diff範囲・仕様整合性・`test-gate`結果の確認・PRとマージの分離という共通チェック項目のみを持つ。具体的なbuild/test/lintコマンド等は各アプリケーション側の`AGENTS.local.md`を参照する。

## ローカルAI間ハンドオフ（C分類・repository固有の採用判断を伴う）

- **`local-ai-handoff`**：同一PC上のローカルAI CLI間で状態・監査結果・次指示をファイル経由で受け渡す共通プロトコル。ライブの`.ai-handoff/`実データは採用する各application repository側に置く。

## アプリケーションrepository側での扱い

- アプリケーションrepository側の`.agents/skills/`以下は、この共通基盤repositoryからの**同期コピー**です。
- アプリケーションrepository側で、この同期コピーを直接編集しません。
- アプリケーション固有の変更・追加手順は、そのアプリケーションrepository側の`AGENTS.local.md`に記載します。
- 技術スタック固有の具体的コマンドも、共通スキルへは書かず`AGENTS.local.md`に記載します。
- 完全同期・最新版・適用済みと表現する前に`foundation-sync-audit`または同等の固定SHA間remote比較をPASSさせます。部分同期は完全同期と表現しません。
