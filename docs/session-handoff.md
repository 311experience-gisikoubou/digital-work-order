# Session Handoff

このファイルは、作業の「現在地点」を次の担当（AIまたは人間）に引き継ぐための文書である。
恒久仕様の正本ではない。業務・画面仕様の正本は `docs/design.md`、
恒久的な作業ルールの正本は `AGENTS.md` / `AGENTS.local.md` である。

このファイルは作業ごとに上書き更新してよい。

## 更新日時

- 2026-10-02

## 現在branch

- feat/media-local-storage-phase2（基準: origin/main 5ffe6cefa6c1b4075fd839af422a937add121dbc）

## 完了したこと

- Issue #119 Phase 2として、参考資料メディアのローカル永続化とworkOrderRef紐付けを実装した（`media-storage.js` 新規、`media.js` / `app.js` / `index.html` 最小変更）。
- Blob本体はOPFS（`dwo-media-v1/blobs/<attachmentId>`）、metadataはIndexedDB（`dwo_media_v1`）。受注確定時に既存の `workOrderRef`（生成タイミングは不変）へmetadata ownerを1 transactionで再紐付けし、active draftを更新する。OPFSファイルは移動しない。
- 添付があり保存できない場合は受注へ反映せずfail closed。非対応環境ではメモリ内添付のまま、添付0件の受注は従来どおり。
- `tests/media-storage.test.js` を追加（架空データのみ）。`tools/media-storage-e2e.mjs`（headless Chrome）でOPFS+IndexedDBの追加→再読込→復元→削除→commitを確認した。
- `docs/design.md` 第15.13節にPhase 2実装事実を追記した。Phase 0/1要件は不変。
- GPT独立監査の指摘（保存失敗時のfail closed・不正metadata/size不一致の紐付け前中止・復元の厳格化）を追補コミットで反映済み。
- Draft PR #120「feat: メディア添付ローカル永続化 Phase 2」を作成済み。mergeは行っていない。
- iPad Safari実機で、PR #120 / product code HEAD `3fc96e1` を対象に「写真撮影 → 表示 → 再読み込み後も残る → 削除 → 再読み込み後に復活しない」を確認し、Phase 2のOPFS/IndexedDB実機保存経路をPASSとした。

## 既知の保留検証項目

- 音声のiPad実機確認（HTTPS環境でのRelease Gate）: Phase 1から維持。今回音声仕様は変更していない。
- iPad SafariでのOPFS/IndexedDB実機保存は確認済み（写真撮影→再読み込み復元→削除→再読み込みで非復活）。受注確定時の `workOrderRef` 紐付けはheadless Chrome E2Eで確認済みで、iPad上のフォーム全体操作までは追加実施していない。
- 参考資料カードの案内文は監査指摘対応で「この端末内に一時保存されます。外部には送信されません。」へ更新済み（承認済み文言）。

## 未完了

- 状態遷移UI・送信処理・暗号化・クラウド・PC受信は後続Phase（3以降）。
- OPFS orphan（metadataなし）の自動削除は未実装（送信対象にはならない）。

## 次の最小作業

- GPTが最新HEADでfinal-pr-auditを完了し、PR #120をmerge手前で停止する。人間の明示的なmerge許可を待つ。

## blocker

- なし。

## 人間確認が必要な項目

- Phase 1から継続する音声録音のHTTPS実機Release Gate（本番利用前）。
- 明示的なmerge許可のみ（人間が明示的に指示した場合のみ実施）。
