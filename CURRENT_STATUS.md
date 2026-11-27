# CURRENT_STATUS.md

このファイルは、プロジェクトの「いまどこか」を短く復元するための現在地点の正本です。
仕様書・履歴・議事録を複製せず、製品・主要タスクの安定した現在地だけを保ちます。

- Status: `ACTIVE`
- Current phase: `Approved teal iPad input/PDF baseline is implemented; existing verified Windows inbox/viewer and billing JSON handoff are available. Drive + Apps Script is the current provisional relay candidate (not production adoption). Issued B5 transfer preparation and signed recovery are locally verified in the PR #180 changes; ordinary live send is not yet enabled.`
- Active product Issue: `#172 (automatic receive and final real-device acceptance remain incomplete)`
- Active product PR: `NONE`
- Last completed product work: `Approved teal layout (#163/#164); synthetic actual iPad-to-Drive-to-Windows receipt/save/delete (#168/#170); retained receive/viewer (#172); #180 bounded issued B5/attachment preparation, signed recovery, local receive/viewer safety corrections, and synthetic billing intake compatibility checks. These are separate evidence levels, not a full production PASS.`
- Current blocker: `Independent review of the new chunk/recovery candidate, authorized production pairing/send, current Safari preview route, and real integrated transfer/automatic receive remain unverified. Prior isolated Claude audit timed out; do not repeat it unchanged. The large-media candidates in the isolated Windows evidence directory are not product code.`
- Next action: `Reuse all applicable passing evidence in docs/drive-apps-script-relay-production-design-20261007.md and PR #180. Complete the missing independent review and qualified Safari preview route; integrate the existing large-media candidate only after its safety gate permits it, then verify the current integrated real transfer and final Windows receive. No repeated unchanged tests or new parallel trial systems.`
- PC-free work: `Existing-source review and evidence reconciliation only; no real data or production credentials.`
- PC-required work: `Current iPad Safari signed recovery and integrated real relay, Windows automatic receive after off/sleep/reconnection, verified receipt/delete and actual billing handoff. Defer disruptive Windows logoff until final acceptance as already decided in #172.`
- User action required: `NO at this checkpoint. Individual merge, actual device operation, production pairing/configuration, key backup/retention, and real-data activation retain their existing approval boundaries. Do not request repeated registration or previously completed device checks.`
- Merge authorized: `NO`
- Last product-state update: `2026-11-27`

This checkpoint describes the resulting source state if PR #180 is merged; until then #180 remains a draft, and the isolated candidates are not included in it. The earlier Firebase/Blaze activation runbook remains historical evidence, not the next execution instruction. Drive + Apps Script remains provisional under its existing gates A-E.

## Optional short notes

- Phase 2の入力・保存・出力正本は `docs/phase2-input-save-output-spec.md`、項目表は `docs/phase2-field-matrix.md`、schemaは `docs/phase2-schema-v1.md`、互換/変更範囲は `docs/phase2-compatibility-change-scope.md`。
- 採用済みUI配置と歯式同期基準は `docs/canonical/` の2 JSONを正本とし、歯形態を描き直さない。
- U01: 編集中フォームは端末内draft 1件としてタブ/ブラウザ終了後も再開可能。`app/draft-persistence.js` の `dwo_form_draft_v1` で実装済み。`FormDraftManager`（`getCurrentDraftRef` / `ensureCurrentDraftRef` / `removeCurrentFormDraft`）が唯一のdraft authorityで、`draftRef === mediaOwnerRef` を維持する。
- U02: 「この内容で発行する」は受注確定 + PDF作成。技工所PC送信完了ではない。正式発行は `app/final-issue.js` がPDF生成・session保存・メディアowner確定・draft削除をfail closedで連結する。
- U03/U04: missing/abutmentは排他、cautionは独立。既存歯形態を維持した2軸状態を32歯で実装済みで、数字・図・発行snapshotが同じ状態を参照する。
- U06: B5上下2面を維持し、8番歯・模型発送予定日・急ぎ料金をPDFへ反映済み。2件印刷は各受注のsnapshotを独立描画し、既存休日/料金式は変更していない。
- 現行 `state.orders` は同一タブ `sessionStorage` 復元のまま。Phase 2のdraft永続化と発行済み受注の長期DB化を混同しない。
- メディア永続化（`media-storage.js` / `media.js`）はOPFS（Blob本体）+ IndexedDB（metadata）で実装済み。`persistAttachment` / `restoreOwner` / `removeOwner` / `commitDraftToWorkOrder` は呼び出し側が渡す明示的な `draftRef` / `ownerRef` だけで動作し、media-storage自身は独立したactive draftを生成・補修・ローテーションしない。IndexedDBの `settings` オブジェクトストアは、下書きauthorityではない。PR #180では限定した暗号化outbox試験recordにも再利用するが、通常送信の認可を付与しない。
- `ReferenceMediaManager.commitCurrentDraft(workOrderRef)` は正式発行フローから使用され、添付を `draftRef` から `workOrderRef` へ確定する。後工程失敗時の補償用rollbackも実装済み。
- 紙指示書は既存のブラウザ内ローカルOCR + 人間確認 + 成功後破棄を維持する。
- 複数クラスプ/バーは配列で発行受注・session・詳細・PDFへ保持し、`digital-work-order-intake-v1` の旧単一値互換は維持する。stable `workOrderRef` も維持する。
- Phase 5はPhase 4暗号Envelopeだけを署名検証済みrelayへ送るtransportを追加した。本番Firebase/Google Cloudへのデプロイ・課金有効化・実データ送信は未実施。通常削除はPhase 7、30日Lifecycleは異常時の上限。
- Phase 6はreceiver bootstrap・pending-job discovery・短寿命download URL・Windows Gatewayを追加し、ciphertext照合 → bootstrap復号 → Phase 4署名/復号 → Phase 3完全性確認 → atomic local保存まで実装した。
- Phase 7はverified local保存後だけACKする。receiver bearer + job専用capability + 復号後に計算できるACK proofを要求し、ready→deleting遷移後にexact objectだけを冪等削除、全object不存在確認後にjob metadataを削除する。途中失敗は次pollでdeleting状態から再開する。本番cloud/Windows設定は未実施。
- Phase 8は既存Gateway inboxをそのまま正式な受信済み保存先として再利用し、`127.0.0.1`限定のread-only viewerで指示書・写真・動画・音声を閲覧できる。DWO側にSQLiteは追加せず、既存`digital-work-order-intake-v1`をダウンロードしてdental-delivery-billingの既存取込へ渡す。2026-10-03に実際の技工所Windows PCでBOMなしの架空設定・空の一時inboxを使い`run-viewer.ps1`を起動し、localhost `200`、foreign Host `403`、inbox無変更を確認した。自動archive/削除・本番backup先/保管期間・production activationは未実施。
- `docs/production-activation-runbook.md` はPhase 5-8のアーキテクチャと`cloud/README.md`/`gateway/README.md`を正本としたまま、本番activationをStage 0（repo/local readiness）からStage 10（実データgo-live）まで順序付け、各StageをAI_SAFE_PREP/HUMAN_APPROVAL_REQUIRED/HUMAN_INTERACTIVE/AFTER_APPROVAL_AI_CAN_EXECUTEのいずれかに明示する。budget金額とbackup先/保管期間は未解決の人間決定として残し、本PRはどのStageも実行しない。`gateway/ops/production-readiness-preflight.mjs`（dependency-free, read-only, no network/cloud CLI）と`gateway/ops/production-readiness-preflight-selftest.mjs`（合成fixtureのみ、repo artifactを残さない）は実装・検証済みでmerge-ready。

## Rules

- ここには長い仕様・過去ログ・詳細なテスト結果を複製しない。
- 実装済みか不明な事項を「完了」と書かない。
- docs-onlyのstatus同期Issue / branch / PR自身は、Current phaseやActive product Issue / PRへ記録しない。
- feature PR内で更新する場合は、そのPRの作業中状態ではなく、merge後に成立する製品状態を書く。
- exact main SHAを必須項目にしない。現在のmain SHAはGitで確認する。
- maintenance同期そのものをLast completed product workへ積み上げない。
- 製品・主要タスク、Blocker、PC要否の状態が変わった時だけ更新する。
- `Merge authorized: YES` は、有効な人間の明示merge承認が存在する場合だけ使用する。
