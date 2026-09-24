# Session Handoff

このファイルは、作業の「現在地点」を次の担当（AIまたは人間）に引き継ぐための文書である。
恒久仕様の正本ではない。業務・画面仕様の正本は `docs/design.md`、
恒久的な作業ルールの正本は `AGENTS.md` / `AGENTS.local.md` である。

このファイルは作業ごとに上書き更新してよい。

## 更新日時

- 2026-09-25

## 現在branch

- feat/media-attachments-phase1（基準: origin/main 10061baf55ad98192a047ccb1de0266bac3f870e）

## 完了したこと

- Issue #117 Phase 1として、参考資料をiPadメディアUIへ置き換えた（`media.js` 新規、`index.html` / `style.css` 最小変更、`app.js` 変更なし）。
- 写真・動画のcapture入力、音声録音（MediaRecorder）、複数ファイル追加、プレビュー/再生、個別削除、Object URL revokeを実装した。ブラウザ内一時メモリのみ。
- `tests/media.test.js` を追加（架空サンプルのみ）。全 `tests/*.test.js` がPASS。
- GPT独立監査で全テスト 90 PASS / 0 FAIL を確認し、古い文書参照1件（design.md 第13節の `ref-media` 表記）を見つけて修正した。final-pr-auditはPASSではない（PR未作成のため未実施）。
- `docs/design.md` 第15.12節にPhase 1実装事実を追記した。Phase 0境界は不変。
- PRは未作成（GPTが独立監査後にDraft PRを作る）。mergeは行っていない。

## 未完了

- iPad Safari実機での確認は未確認: カメラ/動画capture、マイク権限、録音の再生、見た目。
- `workOrderRef` への紐付け・永続化はPhase 2、送信はPhase 5以降。
- 離脱時のObject URL解放は `pagehide` のみ（`beforeunload` は離脱確認キャンセル時に添付が壊れるため使わない）。

## 次の最小作業

- GPTがfinal-pr-auditを行い、PASSならDraft PRを作る。

## blocker

- なし。

## 人間確認が必要な項目

- iPad Safari実機でのメディア操作確認（上記未確認項目）。
- merge許可（人間が明示的に指示した場合のみ実施）。
