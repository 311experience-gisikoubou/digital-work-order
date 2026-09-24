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
- GPT独立監査で全テスト 90 PASS / 0 FAIL を確認し、古い文書参照1件（design.md 第13節の `ref-media` 表記）を見つけて修正した。final-pr-auditの自動/コード/GitHub確認はここまで完了したが、必須のiPad Safari実機確認が未実施のため、全体PASSはまだ出せない。
- `docs/design.md` 第15.12節にPhase 1実装事実を追記した。Phase 0境界は不変。
- Draft PR #118「feat: iPadメディア添付UI Phase 1」を作成した（現在もDraft PR #118が現行）。mergeは行っていない。
- 自動確認とコード/GitHubレビューは完了した。
- iPad実機テストを一度実施した。Phase 1のUIには到達でき、写真/動画/ファイルの流れについて、このテストからblockerの報告はない（詳細なPASS証拠は記録していない）。音声のみ未検証。

## 既知の保留検証項目（音声のiPad実機確認）

- 音声録音はiPad実機で検証できなかった。LAN previewが平文HTTPで配信され、Safariが `navigator.mediaDevices` / `getUserMedia` を公開しなかったため（HTTPはsecure contextではない）。
- これはpreview環境のsecure context制約であり、アプリコードの欠陥の証拠ではない。同時に、コードのPASSでもない。既知の保留検証項目として扱う。
- ローカル証明書による回避は中止した。承認済みのHTTPS preview/デプロイ環境が用意できるまで、正式な音声のiPad実機確認は保留とする。
- 製品要件は変わらない: アプリ内での音声の開始/停止/再生/削除は必須。実装コードとPhase 0構成は変更していない。

## 未完了

- 音声のiPad Safari実機確認（マイク権限、録音、停止、再生、削除）: 保留。承認済みHTTPS環境が最初に用意された時点で再実施する。本番利用前に必須。
- 写真/動画captureの見た目など、その他の実機確認は詳細な証拠を記録していない。
- `workOrderRef` への紐付け・永続化はPhase 2、送信はPhase 5以降。
- 離脱時のObject URL解放は `pagehide` のみ（`beforeunload` は離脱確認キャンセル時に添付が壊れるため使わない）。

## 次の最小作業

- GPTが現在のscopeについてfinal-pr-auditを実施し、merge前で停止する。
- 後日、最初の承認済みHTTPS環境が用意された時点で、本番利用前に音声のiPad実機確認を再実施する。

## blocker

- なし（音声の実機確認は上記の既知の保留項目であり、現scopeのaudit進行を止めるものではない）。

## 人間確認が必要な項目

- 人間の確認事項は、明示的なmerge許可のみ（人間が明示的に指示した場合のみ実施）。
- 後日のHTTPS環境での音声実機確認は運用上の検証であり、設計判断ではない。
