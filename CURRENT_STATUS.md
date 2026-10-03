# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、製品・主要タスクの安定した現在地だけを保ちます。

- Status: `ACTIVE`
- Current phase: `Media transfer Phase 6 lab-PC receive/decrypt/verify/atomic-local-save implemented and verified; production cloud/Windows deployment remains intentionally unexecuted`
- Active product Issue: `NONE`
- Active product PR: `NONE`
- Last completed product work: `Media transfer Phase 6: encrypted receiver bootstrap, authenticated ready-job discovery, short-lived downloads, ciphertext verification, Phase 4/3 decrypt+integrity verification, DPAPI secret handling, and atomic local inbox persistence are implemented and verified`
- Current blocker: `NONE`
- Next action: `After Phase 6 merge, proceed to Phase 7 receiver acknowledgement and immediate relay deletion; production cloud/Windows activation remains a separate authenticated operation`
- PC-free work: `Phase 6 PR review / GitHub audit / Phase 7 ACK-delete design`
- PC-required work: `real lab-PC synthetic setup verification and, separately, human-authenticated Firebase/Google Cloud production activation when authorized`
- User action required: `NO for code preparation; explicit merge authorization is required for the Phase 6 PR, and production cloud/IAM/DPAPI setup remains a separate authenticated human action`
- Merge authorized: `NO`
- Last product-state update: `2026-10-03`

## Optional short notes

- Phase 2の入力・保存・出力正本は `docs/phase2-input-save-output-spec.md`、項目表は `docs/phase2-field-matrix.md`、schemaは `docs/phase2-schema-v1.md`、互換/変更範囲は `docs/phase2-compatibility-change-scope.md`。
- 採用済みUI配置と歯式同期基準は `docs/canonical/` の2 JSONを正本とし、歯形態を描き直さない。
- U01: 編集中フォームは端末内draft 1件としてタブ/ブラウザ終了後も再開可能。`app/draft-persistence.js` の `dwo_form_draft_v1` で実装済み。`FormDraftManager`（`getCurrentDraftRef` / `ensureCurrentDraftRef` / `removeCurrentFormDraft`）が唯一のdraft authorityで、`draftRef === mediaOwnerRef` を維持する。
- U02: 「この内容で発行する」は受注確定 + PDF作成。技工所PC送信完了ではない。正式発行は `app/final-issue.js` がPDF生成・session保存・メディアowner確定・draft削除をfail closedで連結する。
- U03/U04: missing/abutmentは排他、cautionは独立。既存歯形態を維持した2軸状態を32歯で実装済みで、数字・図・発行snapshotが同じ状態を参照する。
- U06: B5上下2面を維持し、8番歯・模型発送予定日・急ぎ料金をPDFへ反映済み。2件印刷は各受注のsnapshotを独立描画し、既存休日/料金式は変更していない。
- 現行 `state.orders` は同一タブ `sessionStorage` 復元のまま。Phase 2のdraft永続化と発行済み受注の長期DB化を混同しない。
- メディア永続化（`media-storage.js` / `media.js`）はOPFS（Blob本体）+ IndexedDB（metadata）で実装済み。`persistAttachment` / `restoreOwner` / `removeOwner` / `commitDraftToWorkOrder` は呼び出し側が渡す明示的な `draftRef` / `ownerRef` だけで動作し、media-storage自身は独立したactive draftを生成・補修・ローテーションしない。IndexedDBの `settings` オブジェクトストアはschema互換のためだけに残し、authorityとしては使わない。
- `ReferenceMediaManager.commitCurrentDraft(workOrderRef)` は正式発行フローから使用され、添付を `draftRef` から `workOrderRef` へ確定する。後工程失敗時の補償用rollbackも実装済み。
- 紙指示書は既存のブラウザ内ローカルOCR + 人間確認 + 成功後破棄を維持する。
- 複数クラスプ/バーは配列で発行受注・session・詳細・PDFへ保持し、`digital-work-order-intake-v1` の旧単一値互換は維持する。stable `workOrderRef` も維持する。
- Phase 5はPhase 4暗号Envelopeだけを署名検証済みrelayへ送るtransportを追加した。本番Firebase/Google Cloudへのデプロイ・課金有効化・実データ送信は未実施。通常削除はPhase 7、30日Lifecycleは異常時の上限。
- Phase 6はreceiver bootstrap・ready-job discovery・短寿命download URL・Windows Gatewayを追加し、ciphertext照合 → bootstrap復号 → Phase 4署名/復号 → Phase 3完全性確認 → atomic local保存まで実装した。ACK/cloud削除はPhase 7。本番cloud/Windows設定は未実施。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- docs-onlyのstatus同期Issue / branch / PR自身は、Current phaseやActive product Issue / PRへ記録しない。
- feature PR内で更新する場合は、そのPRの作業中状態ではなく、merge後に成立する製品状態を書く。
- exact main SHAを必須項目にしない。現在のmain SHAはGitで確認する。
- maintenance同期そのものをLast completed product workへ積み上げない。
- 製品・主要タスク、Blocker、PC要否の状態が変わった時だけ更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
