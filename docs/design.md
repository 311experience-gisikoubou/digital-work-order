# Digital Work Order Design

## 1. アプリ概要

- 本アプリはデジタル歯科技工指示書である。
- 主利用環境は、既存文書上では iPad Safari + Apple Pencil を主目的としている。
- 現在の構成は HTML / CSS / JavaScript 中心で、主入口は `index.html`。
- 現在の実行方式は、ローカル確認では作業ブランチの `index.html` をブラウザで開く方式。公開環境の有無は、このリポジトリ内のファイルだけでは未確定。
- 現在の主要ファイルは `index.html`, `style.css`, `app.js`, `tooth-chart.js`, `calendar.js`, `pdf.js`, `orders.js`, `modal.js`, `validate.js`, `date-utils.js`, `toast.js`。
- `clasp.js` は現時点では存在せず、クラスプ処理は `tooth-chart.js` 内にある。

## 2. 仕様の正本

- 今後、確定した業務仕様・画面仕様は `docs/design.md` を正本とする。
- `README.md` は利用・確認手順を置く。
- `CLAUDE.md` はAI作業ルールを置く。
- 今回は `README.md` と `CLAUDE.md` 自体は変更しない。

## 3. 保険 / 自費

- 区分値は `insurance` と `jishi`。
- 正本状態は `app.js` の `state.insuranceType`。
- 初期値は `insurance`。
- 保険は中11日、自費は中14日として扱う。
- `calendar.js` の `getStdDays()` は `state.insuranceType === 'jishi'` のとき `14`、それ以外は `11` を返す。
- `setInsurance(type)` は `state.insuranceType` を更新し、以下を同期する。
  - `#btn-insurance` / `#btn-jishi` の active 表示
  - `#prosthetics-insurance` / `#prosthetics-jishi` の表示
  - `#ds-insurance-label` / `#ds-jishi-label` の表示
  - `onShippingDateChange()` による模型発送予定日・推奨納品日・カレンダー・割増判定の再計算
- 上部ラベルは既存DOMの `#ds-insurance-label` と `#ds-jishi-label` を表示切替する。
- `collectFormData()` は `state.insuranceType` を `insuranceType` として収集し、保険/自費ごとに参照するDOMグループを切り替える。

## 4. 手書き

- 手書きモードは `drawMode` で ON / OFF を管理する。
- 入力方式は `drawInputMode` で管理し、初期値は `pen`。
- 入力方式は `pen` と `finger`。
- `pen` はUI上の「ペンのみ」、`finger` は「指でも書く」に対応する。
- `isPenPointer(e)` は `e.pointerType === 'pen'` を判定する。
- `isTouchPointer(e)` は `e.pointerType === 'touch'` を判定する。
- `canStartDrawingPointer(e)` は、既存の描画pointerがない場合に、Apple Pencilまたは条件を満たすtouchだけ描画開始を許可する。
- `pen` モードでは Apple Pencil の描画を許可し、touchでは描画開始しない。
- `finger` モードでは Apple Pencil と、active touch pointer数が1本のtouchで描画開始できる。
- active touch pointer は `activeTouchPointers` で手書き機能全体として管理する。
- 2本目のtouchが入った場合、touch由来の進行中描画は `cancelActiveTouchDrawing()` によりキャンセルする。
- touch描画キャンセル時、進行中の一時pathは削除され、不完全なstrokeは `drawStrokes` / `memoStrokes` に追加されない。
- pen描画中にtouchが入っても、pointerId / pointerType のガードにより、touch側イベントでpen描画を終了しない構造になっている。
- 手書きON時、`toothSvg` / chart wrap / `memoSvg` / memo wrap の inline `touchAction` は `pinch-zoom`。
- 手書きOFF時、上記の inline `touchAction` は空文字に戻される。

## 5. 手書き保存仕様

以下は変更時に影響範囲確認が必要な現行仕様である。

保存キー:

`dwo_drawing_v1`

保存構造:

```json
{
  "strokes": [],
  "memoStrokes": []
}
```

- `strokes` は歯式図側の手書きstroke配列。
- `memoStrokes` は右側メモ欄の手書きstroke配列。
- `saveDrawing()` は `localStorage.setItem('dwo_drawing_v1', JSON.stringify({ strokes: drawStrokes, memoStrokes: memoStrokes }))` で保存する。
- `loadDrawing()` は同じキーから読み込み、`strokes` と `memoStrokes` があれば復元する。

## 6. クラスプ保存仕様

- クラスプ処理は `tooth-chart.js` 内にある。
- localStorageキーは `dwo_clasp_v1`。
- `saveClaspState()` は `claspState` をJSON文字列化して `localStorage` に保存する。
- `loadClaspState()` は `dwo_clasp_v1` を読み込み、JSONとしてparseし、歯番号ごとの配列を `claspState` へ戻す。
- `claspState` はコード上 `{ 歯番号: [{ uid, type, dir, isTwin1, twinWith, cx, cy, sx, sy, angle }] }` という形のコメントがある。
- クラスプ種類キーはコード上 `W`, `E`, `T`, `C`, `H`, `R`, `I`, `WI` が定義されている。

## 7. PDF

- PDF関連処理は `pdf.js`。
- `exportPDF(id, id2)` は印刷用HTMLを iframe に書き込み、`iframe.contentWindow.print()` を呼ぶ。
- `jsPDF` は使用していない旨のコメントがある。
- 印刷用HTMLは `_buildPrintHTML()` で組み立てる。
- `exportPDF()` は `.chart-wrap` の `outerHTML` を印刷用HTMLへ埋め込む。
- `memoSvg` に `.draw-path` が1本以上ある場合、`memoSvg.outerHTML` を印刷用HTMLへ埋め込む。
- PDF出力内では `claspState` を参照し、クラスプ配置の件数表示を組み立てる処理がある。
- 印刷後の iframe は `afterprint` または30秒後のcleanupで削除される。

## 8. 歯式図・歯番号

- 歯式図処理は `tooth-chart.js`。
- 歯式チャート側の欠損選択は `state.selectedTeeth` に保持される。
- SVG歯式図側は `toothState` を持つ。
- `syncToothChart()` / `syncToShijiChart()` により、歯式チャートとSVG歯式図の状態を同期する。
- 歯式番号やSVG座標は `tooth-chart.js` 内の歯番号配列、`toothBB`、`coords` などに依存する。
- 歯番号・歯式図・`state.selectedTeeth`・`toothState` の変更は影響範囲が大きいため、変更時は同期挙動の確認が必要。

## 9. カレンダー・日付計算

- カレンダー処理は `calendar.js`。
- 模型発送予定日は `#shipping-date` の値を `onShippingDateChange()` が読む。
- `#shipping-date` が未入力の場合は当日を発送日として扱う。
- 過去日の発送日は当日に補正される。
- `shippingDateGlobal` に発送日が保持される。
- `stdDeliveryDate` は `addBizDays(shippingStr, getStdDays(), holidays)` で計算される。
- `selectedDeliveryDate` は発送日変更時に `stdDeliveryDate` へ設定される。
- `renderVcal()` はカレンダーを描画し、`countBizDays()` と `getStdDays()` に基づいて日付classを付与する。
- `applyDelivery()` は `#delivery-date`、推奨納品日表示、営業日数表示、割増料金表示、送信ボタン状態を更新する。
- 休日判定は `isHoliday()` が行う。現状コードでは以下を休日扱いする。
  - `fetchHolidays()` で取得した祝日JSONに含まれる日
  - 日曜日
  - 08-13 から 08-16
  - 12-28 以降または 01-04 以前
- `fetchHolidays()` は `https://holidays-jp.github.io/api/v1/date.json` を取得する。取得失敗時は空オブジェクトを使う。
- 割増判定は `applyDelivery()` 内の現状コードでは以下の通り。
  - `bizDays <= 1`: 10000
  - `bizDays <= 3`: 10000
  - `bizDays < stdDays`: `stdDays - bizDays` に1000を掛けた額
  - それ以外: 0

## 10. 実機確認

主確認環境:

- iPad
- Safari
- Apple Pencil

現状の重要確認対象:

- 手書き
- Apple Pencil
- 指操作
- 2本指移動 / ピンチズーム
- 保険 / 自費切替
- カレンダー
- PDF
- クラスプ
- 歯番号
- 技工所側の紙指示書画像取り込み

詳細な `manual-ui-smoke-test` は未作成。

## 11. 変更時の重要保護対象

以下は永久変更禁止ではないが、変更時は影響範囲確認と実機確認が必要である。

- `dwo_drawing_v1`
- 手書き保存構造 `{ strokes, memoStrokes }`
- `dwo_clasp_v1`
- PDF処理
- クラスプ処理
- 歯番号・歯式図・`state.selectedTeeth`・`toothState`
- 休日判定
- 割増料金ルール
- `state.insuranceType`
- `index.html` 末尾の script 読み込み順
- `collectFormData()`

## 12. 未確定・将来項目

- Firebase連携はコード上TODOとして存在するが、現状はコメントアウトされており未実装。
- `state.orders.unshift(data)` により、送信データは現在のページ内メモリに追加される。ページリロード後の永続保存は未実装。
- README上、公開環境の有無はリポジトリ内のファイルだけでは確認できない。
- Cloudflare Pages導入予定の記載は既存文書にあるが、現状このリポジトリ内の設定ファイルだけでは実装済みとは確認していない。
- `manual-ui-smoke-test` は未作成。

## 13. 技工所側・紙指示書画像取り込み（Phase 1）

- 技工所側の `view-lab` に「紙指示書の取り込み」を表示する。
- 「紙指示書を取り込む」から `image/*` を選択でき、対応端末では `capture="environment"` により背面カメラを優先する。
- 選択画像は `URL.createObjectURL()` による端末内の一時プレビューだけに使用する。
- ファイル名を表示し、別画像への差し替えを可能とする。
- 「画像を破棄」でプレビュー・ファイル名・入力状態をクリアし、使用中のObject URLを `URL.revokeObjectURL()` で解放する。
- 別画像への差し替え時とページ離脱時も、使用中のObject URLを解放する。
- Phase 1では画像を `localStorage` / IndexedDB / Cache Storage / `state.orders` に保存しない。
- Phase 1では取り込んだ画像を外部API・Firebase等へ送信しない。
- 医院側の既存 `ref-media` とは独立した技工所側機能として扱う。
- Phase 1ではOCR・AI解析・項目自動入力・データ化は行わない。
- iPad Safari実機で、表示・カメラ起動・プレビュー・差し替え・破棄・医院側/受注管理切替を確認済み。
- 将来のOCR/データ化は、次節のPhase 2設計に従う。OCR・フォーム反映・画像自動破棄の実装は別Issueで扱う。

## 14. 紙指示書のローカルデータ化（Phase 2設計 / Issue #37）

本節の承認済み境界は `OPERATIONAL`、必要な強制レベルは `TECHNICAL_ENFORCEMENT_REQUIRED`。Issue #39でOCR・候補確認・フォーム反映/照合を実装した（14.5）し、iPad Safariの架空データ実機確認までPASS。後続のIssue #41では精度改善を試したが実機で意味のある候補改善を得られず、PR #42はmergeしなかった。OCRは補助機能とし、紙画像を見ながらの手入力を主経路とする。画像自動破棄は未実装。

### 14.1 初期の処理・通信境界

- OCR / データ抽出は、iPad Safariのブラウザプロセス内で実行する方式を採用する。
- 将来のOCRエンジン・モデル・worker・言語データは、アプリに同梱したローカル資産を使用する。実行時に公開CDNから取得しない。
- 選択した紙指示書画像は、ブラウザ内の一時的なFile / Object URL / メモリ上のデータとしてのみ扱う。OCRのためにサーバーへアップロードしない。
- 紙指示書画像および患者・医院・受注情報を、外部OCR API、外部AI API、Firebase、公開クラウドストレージ、外部AI処理へ送信・保存しない。画像・候補値を外部ネットワーク経路へ流さない。
- 既存アプリは別途、日本の祝日データを外部祝日APIから取得する（第9節）。したがってアプリ全体をオフラインとは呼ばない。本Issueの境界は紙指示書画像と患者・医院・受注情報であり、既存の祝日取得動作は対象外・変更なし。

| 方式 | 初期Phase 2での扱い | 理由 |
| --- | --- | --- |
| iPad Safariブラウザ内 | 採用 | 画像転送や補助サービスを追加せず、人間確認まで同じブラウザ内に一時保持できる。性能・互換性は今後検証する。 |
| 専用PC上のOCR | 初期は不採用、代替候補のみ | iPadからの画像転送境界、サービスの起動・停止・更新管理、障害要因、攻撃対象が増える。 |
| 同一LANのOCRサービス | 初期は不採用、代替候補のみ | LAN内でも画像転送境界、サービスの起動・停止・更新管理、障害要因、攻撃対象が増える。 |

専用PC / 同一LAN方式は、機密性のないテストデータでブラウザ内処理の性能・互換性が不十分と確認された場合に限り再検討する。自動的な切替先にはせず、採用前に画像転送・保持・アクセス境界を別途設計する。

### 14.2 一時データのライフサイクルと成功条件

`撮影/選択 → ブラウザ内の一時画像 → ローカルOCR/抽出 → 候補値 → 人間の確認/修正 → 明示的な人間承認 → 承認値を既存フォームへコピー → コピー先の値を照合 → 元の一時画像が破棄可能になる`

- 画像と候補値はブラウザ内の一時データとし、永続化や復旧用ストレージを追加しない。
- 人間承認前の候補値を、既存フォーム、`state.orders`、localStorage、IndexedDB、Cache Storage、確定レコードへ直接書き込まない。
- 人間が確認・修正して明示承認した対象項目だけを、対応する既存フォームのコントロールへコピーする。未承認項目は書き込まない。
- OCR完了だけでは「データ化成功」ではない。成功は以下のすべてを満たす場合に限る。

1. ユーザーが候補項目を確認し、必要な修正を行った。
2. 反映する対象項目を明示的に承認した。
3. 承認済みの値を、対応する既存フォームのコントロールへコピーした。
4. アプリがコピー先のコントロールを読み戻し、承認値と一致することを確認した。

この成功条件を満たした後に限り、後続の実装Issueで画像の自動破棄を検討できる。フォームへの反映成功は受注の確定・送信を意味せず、既存の受注確認フローを継続する。本Issueでは自動破棄を実装しない。破棄時にはObject URLとアプリ内の画像参照を解放するが、端末の写真ライブラリ等に元から存在するファイルの削除は対象外とする。

| 事象 | 安全側の動作 |
| --- | --- |
| OCR / 抽出失敗 | フォームへ書き込まない。一時プレビューを保持し、再試行・画像差し替え・手入力を選べるようにする。 |
| ユーザーがキャンセル | フォームへ書き込まない。画像は明示的な破棄またはページ終了まで一時保持する。 |
| コピー失敗 / 読み戻し不一致 | 成功扱いにせず、自動破棄しない。一時画像を保持して不一致を示し、修正・再確認を必要とする。 |
| ページ離脱 / リロード | 復元は要件にしない。一時画像・候補値は設計上失われてよい。永続化を追加しない。 |
| クラッシュ | 画像・候補値の復旧用保存を追加しない。再開時の復元を保証しない。 |

信頼度スコアは将来、確認の参考として表示してよいが、自動承認・自動確定の根拠にしない。

### 14.3 初期候補項目の最小セット

`validate.js` の既存必須項目は次の4項目である。初期対象をここに限定し、試行範囲を小さく保ち、人間による照合を容易にする。

| 候補フィールド | 項目 | 対応する既存フォームコントロール |
| --- | --- | --- |
| `clinicName` | 歯科医院名 | `#clinic-name` |
| `doctorName` | 担当歯科医師 | `#doctor-name` |
| `patientName` | 患者名 | `#patient-name` |
| `deliveryDate` | 納期 | `#delivery-date` |

抽出値はすべて候補にとどめる。印字・手書きの品質が低い場合や確実に読めない項目は、未解決 / 空欄にして手入力を必須とし、推測で埋めない。納期は既存のhiddenコントロールに対応するため、人間が確認できる候補表示と反映後の照合が必要となる。候補の納期をカレンダー計算で推測・補完しない。

備考・自由手書き、歯式図 / `selectedTeeth`、クラスプ、装置詳細、保険 / 自費、カレンダー計算、PDF、およびその他すべての項目は明示的に後回しとする。

### 14.4 今回の完成条件と次の実装単位

Issue #37の完成条件は、処理境界、一時データの保持・破棄条件、人間承認と反映照合、失敗時の扱い、最小4項目を文書化すること。これはPhase 2の実装完了を意味しない。

次の実装Issueは、この境界に従ったブラウザ内OCRの4項目候補表示・確認/修正・明示承認・既存フォーム反映/照合を1つの最小フローとして扱う。機密性のないテストデータによるiPad Safariの性能・互換性と、通信・非永続化・未承認時の書き込み禁止・失敗時の保持を検証することを出口条件とする。エンジン選定と技術的強制はそのIssueで行い、確認できるまでは実データ用途へ進めない。画像自動破棄はさらに後続の実装Issueで検討する。

Issue #37の設計PRにはOCRライブラリ・モデル・依存関係・アプリコード・fixture・実データを追加しない。

### 14.5 Issue #39の実装事実

- `consumer-rules.js` の既存Phase 1動的パネル `#paper-work-order-import-panel` にOCR操作を追加する。既存のfile input、preview、filename、discard、Object URL管理を唯一の画像ライフサイクルとし、一時的な `paperWorkOrderFile` をOCRへ渡す。`paper-ocr.js` はOCR・抽出・コピー/照合helperのみで、画像取り込みUIやObject URLを管理しない。
- Tesseract.js 7.0.0 / tesseract.js-core 7.0.0（Apache-2.0）、日本語tessdata_fast、LSTM_ONLY、単一non-SIMDの埋め込みWASMを同梱する。資産・ライセンス・モデルhashは `vendor/ocr/README.md`。
- worker/core/langを明示的な同梱パスに固定し、`cacheMethod: 'none'`を指定する。専用workerはモデル取得先を固定し、GETのみ・redirect拒否・no-storeで取得する。未知のscriptパスとXHR/WebSocketを拒否する。上流bundleのCDN既定値には本アプリ経路から到達しない。
- 候補抽出は信頼度80以上の行の明示ラベルとコロンに限定する。同じ項目の複数行・曖昧な日付・判読不能は空欄のまま。年や納期を推測しない。対象外の帳票レイアウト・手書き精度は保証せず、人間が画像と照合・補記する。
- 項目ごとのチェックと明示的な反映ボタンが承認操作。候補編集はその項目のチェックを解除する。空の承認値は反映しない。選択項目だけをコピーし、コピー先から完全一致を確認する。不一致は失敗とし、変更前値への復元を試みる。
- 納期は既存hiddenコントロールへコピーし、照合結果に可視表示する。カレンダー表示・料金計算・受注確定は呼び出さず、その旨を結果に表示する。
- OCR失敗・候補確認キャンセル・照合失敗・成功のいずれでも画像を保持する。画像差し替え・明示破棄・pagehide/beforeunloadではObject URLとFile参照を解放し、候補を消去して古いOCR結果を無効にする。画像でない選択や空のchangeイベントはPhase 1と同じくプレビューをクリアする。120秒タイムアウトを設け、失敗しても手入力を妨げない。
- 承認前の非書き込み、選択項目限定コピー/照合、OCR資産の取得制限はコードと自動テストで `ENFORCED`。Edge 152の架空fixture確認では外部ホスト解決を遮断したままOCRが完走し、OCR前後でlocalStorage / sessionStorage / IndexedDB / Cache Storageに増減がなく、同梱worker/core/日本語モデルだけをローカル取得した。2026-09-07のiPad Safari架空データ実機確認でもOCR起動、候補表示、未承認非反映、明示承認/照合、キャンセル、破棄、再読込時の非復元を確認した。実データ利用はmerge後の承認済み配備だけを対象とし、一時テストURLでは行わない。
- 検証手順・架空fixture・実機確認結果は `docs/issue39-verification.md`。画像自動破棄、永続化/復元、他の候補項目は追加しない。

### 14.6 Issue #45 紙画像参照つき手入力UI

- OCRはbest-effortの補助とし、紙指示書画像を見ながら既存フォームへ手入力する経路を主とする。
- 受注管理の既存紙画像取り込みに「画像を見ながら入力」を追加し、既存の医院側入力タブへ移動する。フォームは複製せず、既存フォーム本体を1つのレイアウト領域としてそのまま使う。
- 医院側入力には静的な参照asideを1つだけ置き、Phase 1から継続する同一のObject URLを参照する。新しいFileコピー、Object URL、localStorage / IndexedDB / Cache Storage / state.orders保存は追加しない。
- 画像差し替え・明示破棄・pagehide/beforeunloadは既存ライフサイクルを正本とし、参照画像のsrc/表示とclinic側レイアウト状態も同時に更新・消去する。
- 横向き/十分な幅では画像参照と既存フォームを左右2列にし、画像側をsticky表示する。狭い画面では縦積みに戻し、参照画像は「画像を表示 / 画像を隠す」で折りたためる。印刷時は参照パネルを出さない。
- OCRエンジン/パーサ/信頼度、collectFormData()、保存形式、PDF、歯式、clasp、drawing、カレンダー/料金は変更しない。
- 自動テストでは同一Object URL再利用、既存フォームへのナビゲーション、差し替え/破棄/pagehide時の参照消去、折りたたみ、フォーム複製なし、横/縦CSSを確認する。iPad Safariの見た目・操作性は別途実機確認する。
