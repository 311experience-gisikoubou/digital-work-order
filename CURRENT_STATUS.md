# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、製品・主要タスクの安定した現在地だけを保ちます。

- Status: `ACTIVE`
- Current phase: `Phase 2 input/save/output specification canonicalized; implementation pending`
- Active product Issue: `NONE`
- Active product PR: `#120 Draft/open: media attachment local persistence Phase 2; unmerged reuse candidate`
- Last completed product work: `Issue #117 / PR #118: iPad media attachment UI Phase 1`
- Current blocker: `NONE`
- Next action: `implement the Phase 2 canonical specification in minimal verified stages and reconcile PR #120 without treating it as merged`
- PC-free work: `spec review / GitHub audit`
- PC-required work: `implementation, automated tests, browser checks, final iPad subjective verification`
- User action required: `NO until a genuine business choice, real-device subjective check, or merge authorization is needed`
- Merge authorized: `NO`
- Last product-state update: `2026-10-02`

## Optional short notes

- Phase 2の入力・保存・出力正本は `docs/phase2-input-save-output-spec.md`、項目表は `docs/phase2-field-matrix.md`、schemaは `docs/phase2-schema-v1.md`、互換/変更範囲は `docs/phase2-compatibility-change-scope.md`。
- 採用済みUI配置と歯式同期基準は `docs/canonical/` の2 JSONを正本とし、歯形態を描き直さない。
- U01: 編集中フォームは端末内draft 1件としてタブ/ブラウザ終了後も再開可能にする仕様。**未実装**。
- U02: 「この内容で発行する」は受注確定 + PDF作成。技工所PC送信完了ではない。
- U03/U04: missing/abutmentは排他、cautionは独立。既存歯形態を維持する。
- U06: B5上下2面を維持し、8番歯・模型発送予定日・急ぎ料金をPDFへ反映する。既存休日/料金式は変更しない。
- 現行 `state.orders` は同一タブ `sessionStorage` 復元のまま。Phase 2のdraft永続化と発行済み受注の長期DB化を混同しない。
- PR #120は未マージ。OPFS/IndexedDBによるメディア保存とdraft→workOrderRef紐付けを再利用候補とするが、統合HEADで再検証する。
- 紙指示書は既存のブラウザ内ローカルOCR + 人間確認 + 成功後破棄を維持する。
- stable `workOrderRef` と `digital-work-order-intake-v1` は維持する。外部クラウド送信はまだ追加しない。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- docs-onlyのstatus同期Issue / branch / PR自身は、Current phaseやActive product Issue / PRへ記録しない。
- feature PR内で更新する場合は、そのPRの作業中状態ではなく、merge後に成立する製品状態を書く。
- exact main SHAを必須項目にしない。現在のmain SHAはGitで確認する。
- maintenance同期そのものをLast completed product workへ積み上げない。
- 製品・主要タスク、Blocker、PC要否の状態が変わった時だけ更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
