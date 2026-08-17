# .agents/skills/

このディレクトリは、この共通基盤repositoryが正本として持つ共通スキル（`SKILL.md`）の置き場所です。

## 現在の状態（Phase 2）

6スキルすべての本文を正式に追加しました。各スキルの意味・停止条件は、移植元アプリケーションrepositoryから変更していません。技術スタック固有の手順のみを取り除き、各アプリケーションrepository側の`AGENTS.local.md`を参照する形にしています。

## 6スキルの役割とA/B分類

### 完全共通（A分類・技術固有部分を含まないため、原則そのまま移植）

- **`preflight-audit`**：実装・修正・リファクタリング前のGit状態・仕様・既存コード・テストの確認と、想定外差分・仕様矛盾・データ損失リスク・追加費用リスクでの停止。
- **`post-merge-verification`**：GitHub上でPRがマージされた後の、マージ方式（squash／merge commit／rebase merge）確認、tree一致確認、local `main`のfast-forward同期、branch削除の安全判断。
- **`handoff`**：作業を別のチャット・別のAI・別のセッションへ引き継ぐための、paste-ready Markdown形式での状況整理。

### 共通本体＋アプリ側設定（B分類・技術スタック固有部分を分離）

- **`migration-safety`**：既存migrationの不変性、番号・順序確認、fresh適用／既存DBからのupgrade確認、schema整合性確認、data loss防止、backup・rollbackの判断という共通原則のみを持つ。具体的なDB製品名・migrationツール名・コマンドは含まず、各アプリケーション側の`AGENTS.local.md`（Technology Stack・Migration Rules）を参照する。
- **`test-gate`**：変更種別に応じた検証選択、軽い検証から重い検証への順序、失敗時停止、検証結果の状態記録（success/failure/unrun/unneeded/unavailable/interrupted）という共通ワークフローのみを持つ。具体的な実行コマンドは含まず、各アプリケーション側の`AGENTS.local.md`（Repository Commands）を参照する。
- **`final-pr-audit`**：base/head SHA・commit数・変更ファイル・diff範囲・仕様整合性・`test-gate`結果の確認・PRとマージの分離という共通チェック項目のみを持つ。具体的なbuild/test/lintコマンドやdependency管理ファイル名は含まず、各アプリケーション側の`AGENTS.local.md`（Repository Commands・Forbidden Scope・Migration Rules）を参照する。

## アプリケーションrepository側での扱い

- アプリケーションrepository側の`.agents/skills/`以下は、この共通基盤repositoryからの**同期コピー**です。
- アプリケーションrepository側で、この同期コピーを直接編集しません。
- アプリケーション固有の変更・追加手順は、共通スキルへは書かず、そのアプリケーションrepository側の`AGENTS.local.md`に記載します。
- 技術スタック固有の具体的コマンド（ビルド・lint・テスト・migration確認等）も、共通スキルへは書かず、`AGENTS.local.md`に記載します。

## 今後

各アプリケーションrepositoryへの実際の導入・Claude Codeでの実地確認・Codex/Gemini CLIでの認識確認は、Phase 3以降で行います。
