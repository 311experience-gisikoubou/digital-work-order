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
- プロジェクトの完成条件と残件分類は `docs/completion-roadmap.md` に置き、業務仕様そのものは重複させない。

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
- `exportPDF(id, id2)` は用紙選択を開き、B5を標準、A4を代替として選べる。
- B5は182×257mm、A4は210×297mmの1ページPDFとしてブラウザ内で直接生成する。
- 指示書本体のレイアウトは常に182×257mmの上下2面とし、A4ではそのB5内容を中央配置して拡大しない。
- 印刷用HTMLは既存の `_buildPrintHTML()` で組み立て、画面外iframeへ一時描画する。
- 同梱した `html2canvas 1.4.1` で印刷DOMを画像化し、`pdf-lib 1.17.1` で固定寸法PDFへ埋め込む。
- 両ライブラリは `vendor/pdf/` のローカル資産のみを使用し、実行時CDNや外部PDF APIへ患者・医院・受注情報を送らない。
- 生成PDFはブラウザ内のBlob/Object URLとして一時保持し、新しいタブで開く。永続保存先をアプリ側に追加しない。
- 画面外iframeは生成完了または失敗時に削除し、Object URLは一定時間後またはページ離脱時に解放する。
- `.chart-wrap` と手書きメモの既存印刷表現を再利用し、保存形式・歯式・クラスプ・手書きデータ構造は変更しない。

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

`tools/manual-ui-smoke-test.mjs` により、架空データ専用のiPad Safari manual UI smoke previewを再現できる。

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

- Firebase / Firestoreの未実装TODO・接続サンプルは撤去済み。現状の受注反映は外部送信ではない。
- 拠点間のメディア転送（暗号化一時クラウド経由）の将来設計境界は第15節。未実装であり、現行の外部送信禁止は変更しない。
- `state.orders.unshift(data)` により、医院側入力は現在の受注一覧へ反映される。Issue #82で同一タブの `sessionStorage` へも同期し、再読み込み時に厳格検証後の受注のみ復元する。外部送信は行わない。
- `state.orders` が1件以上ある間は受注管理画面に一時受注警告を表示する。同一タブの再読み込みは復元対象だが、タブ/ブラウザ終了時は消失対象。対応ブラウザでは `beforeunload` も有効化するが、iPad Safariでは標準ダイアログ表示を保証しない。

### 12.1 一時受注の再読込復元境界（Issue #80設計）

Issue #82で、受注の自動長期保存ではなく **`sessionStorage` を使った同一タブ内の再読込復元** を実装した。

- 目的は、誤ったページ再読み込みから `state.orders` を復元することに限定する。
- `sessionStorage` は同一origin・同一タブのページセッションに限定し、再読み込み/ページ復元では維持される一方、タブ/ウィンドウを閉じると終了する性質を利用する。
- 患者・医院・受注情報をFirebase / Firestore / 外部クラウド / 外部AIへ送信しない。
- `localStorage` / IndexedDBは今回は採用しない。ブラウザ終了後も残り得るため、保持期限・削除・端末共有時の残留まで含む長期保存設計が別途必要になるためである。
- 明示的なローカルファイル保存も既定経路には採用しない。患者情報を含む重複ファイルがFiles/Downloads等へ長期残留しやすく、手動運用も増えるためである。
- 現行の画面内消失警告は残す。`sessionStorage` はタブ/ブラウザ終了からの復元を保証する仕組みではない。
- `file://`、ストレージ拒否、容量不足、SecurityError等で `sessionStorage` が利用できない場合は、現在のページ内メモリ + 消失警告へ安全にフォールバックし、受注入力自体を壊さない。

保存データはアプリ全体のstateを丸ごと入れず、受注一覧専用のversioned envelopeに限定する。

```json
{
  "schemaVersion": "dwo-session-orders-v1",
  "orders": []
}
```

- 保存キーは `dwo_session_orders_v1`。
- 同一タブで最後に開いていた画面は、別キー `dwo_session_active_tab_v1` に `clinic` / `lab` の2値だけを保存する。患者・医院・受注内容はこのキーへ入れない。
- active tab は allowlist 検証後だけ復元する。不正値・未知値・`sessionStorage` 利用不可時は `clinic` を既定表示とする。
- `lab` を復元した場合は、Issue #82で復元済みの `state.orders` を既存 `renderOrders()` で表示する。

- 保存は `state.orders` の追加・受付・受付取消など、受注配列の意味が変わる操作の直後に同期する。
- `state.orders` が0件ならsession keyを削除する。
- 起動時の復元はJSON parse成功だけで採用せず、schemaVersion、orders配列、各orderの必要形状、`workOrderRef` 形式・重複を検証してから反映する。
- 未知version、不正JSON、不正order、重複 `workOrderRef` はfail closedとし、`state.orders` へ部分復元しない。
- 復元失敗時はsession側の不正データを再利用せず、ページ内メモリの空状態から継続できるようにする。
- PDF / OCR / 歯式 / clasp / drawing / `collectFormData()` の業務意味は変更しない。
- 実装確認は、架空受注のみで「追加 → 再読込 → 復元」「受付状態の再読込維持」「0件時のsession削除」「不正schemaのfail closed」「storage利用不可時のフォールバック」を最低限確認する。
- プロジェクトの完成条件と残件分類は `docs/completion-roadmap.md` を参照する。
- 2026-09-13の読み取り確認ではGitHub Pages自体は存在するが、最新deployは旧feature ref `claude/redesign-dental-form-qG3Ue` / `5fea9c3...` で、current mainの安全改善を含まない。公開入口をcurrent mainへ揃えるまで現行安定版として扱わない。
- `tools/manual-ui-smoke-test.mjs` は実装済み。架空PDF/紙指示書の2経路と主要実機チェックを1コマンドで準備する。

## 13. 技工所側・紙指示書画像取り込み（Phase 1）

- 技工所側の `view-lab` に「紙指示書の取り込み」を表示する。
- 「紙指示書を取り込む」から `image/*` を選択でき、対応端末では `capture="environment"` により背面カメラを優先する。
- 選択画像は `URL.createObjectURL()` による端末内の一時プレビューだけに使用する。
- ファイル名を表示し、別画像への差し替えを可能とする。
- 「画像を破棄」でプレビュー・ファイル名・入力状態をクリアし、使用中のObject URLを `URL.revokeObjectURL()` で解放する。
- 別画像への差し替え時とページ離脱時も、使用中のObject URLを解放する。
- Phase 1では画像を `localStorage` / IndexedDB / Cache Storage / `state.orders` に保存しない。
- Phase 1では取り込んだ画像を外部API・Firebase等へ送信しない。
- 医院側の「参考資料メディア添付UI」とは独立した技工所側機能（紙画像の取り込み）として扱う。
- Phase 1ではOCR・AI解析・項目自動入力・データ化は行わない。
- iPad Safari実機で、表示・カメラ起動・プレビュー・差し替え・破棄・医院側/受注管理切替を確認済み。
- 将来のOCR/データ化は、次節のPhase 2設計に従う。OCR・フォーム反映・画像自動破棄の実装は別Issueで扱う。

## 14. 紙指示書のローカルデータ化（Phase 2設計 / Issue #37）

本節の承認済み境界は `OPERATIONAL`、必要な強制レベルは `TECHNICAL_ENFORCEMENT_REQUIRED`。Issue #39でOCR・候補確認・フォーム反映/照合を実装した（14.5）し、iPad Safariの架空データ実機確認までPASS。後続のIssue #41では精度改善を試したが実機で意味のある候補改善を得られず、PR #42はmergeしなかった。OCRは補助機能とし、紙画像を見ながらの手入力を主経路とする。画像自動破棄はIssue #63で実装し、iPad Safariの架空データ実機確認までPASS。

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
### 14.7 Issue #63 承認反映後の一時画像自動破棄

- OCR候補の確認・修正、反映対象の明示承認、既存フォームへのコピー、コピー先読み戻し一致の4条件がすべて成立した時だけ `clearPaperWorkOrderPreview()` を呼ぶ。
- 成功時はPaper File参照、Object URL、受注管理側プレビュー、医院側参照画像、OCR候補を同じ既存ライフサイクルで解放する。
- OCR失敗、候補確認キャンセル、コピー失敗、読み戻し不一致では一時画像を保持する。
- 端末の写真ライブラリ / Files に元から存在するファイルは削除しない。
- 2026-09-12のiPad Safari架空データ実機確認で、承認反映後の画像消去と「端末の写真・ファイルは削除していません」の表示を確認した。

## 15. メディア転送機能の設計境界（Phase 0 / Issue #115）

本節はメディア転送機能のアーキテクチャを凍結する設計正本である。Phase 0は設計の確定のみを行い、後続Phaseの実装は含まない。Google Cloud / Firebaseの正式採用・課金有効化・暗号方式/ライブラリの最終選定・実データ投入も含まない。

第12節・14.1・第13節の「外部クラウドへ送信しない」は現行実装の境界であり、本節の将来設計が後続Phaseで個別に実装・承認されるまで変更しない。既存機能の挙動も変更しない。

### 15.1 識別子と経路

- 転送・保存・照合の中心IDは既存の `workOrderRef` とする。
- 拠点間転送の経路は「医院iPad → 暗号化された一時クラウド中継 → 技工所Windows PC」とする。
- Local Transfer BridgeはLAN内専用とし、拠点間転送と分離する。Bridgeにクラウド経路を持たせず、クラウド経路にLAN前提を持ち込まない。

### 15.2 暗号化と中継データ

- iPad側で暗号化してからアップロードする。クラウドには暗号文だけを一時保存し、クラウドは正本ではない。平文・鍵をクラウドへ置かない。
- 暗号化対象は `work-order.json`・`manifest.json`・すべてのメディアとする。
- クラウド上のファイル名・オブジェクト名に、患者に関する平文情報・患者名を含めない。中継メタデータは最小限かつ非機微とする。

### 15.3 ペアリング・鍵・署名

- 初回登録はQRコードによるペアリングで行う。
- 技工所PCは、復号用の秘密鍵と、登録済み医院iPadの公開鍵を保持する。
- 医院iPadは自身の署名用鍵ペアを作成し、技工所側の公開鍵を登録する。
- 送信時は、医院iPadがパッケージへ署名し、その後に暗号化する。技工所PCは「登録済みかつ失効していない送信元」で、かつ署名検証に成功したものだけを受け付ける。
- 暗号方式は独自に発明せず、標準方式と成熟したライブラリを使う。具体的なアルゴリズム・ライブラリの選定はPhase 4で行う。
- **【固定要件】技工所PCの復号用秘密鍵は、暗号化したオフラインバックアップを必ず持つ。** これは将来判断ではなく必須要件であり、Phase 4で具体的な保管・復旧手順を定める。バックアップが無い状態で実データ用途へ進まない。
- 紛失したiPadは失効できる。鍵更新（ローテーション）と再ペアリングの手順をPhase 4で定義する。

### 15.4 中継の認可境界

- 医院側は、自分専用の転送領域にだけ書き込める。
- 技工所PCは、読み取りと削除ができる。
- 「受領済み」への状態更新は、技工所PCだけができる。

### 15.5 iPad側のデータ保持と送信

- 技工所の受領完了を確認するまで、iPadはローカルコピーを保持する。iPadは長期の正本ではない。
- 技工所PCの受領完了後に、中継上の暗号文を削除する。ライフサイクルによる期限切れ削除は、放置されたオブジェクトのための安全網であり、通常の経路ではない。
- クラウドのSoft Delete（削除の保持）の挙動は、採用するプロバイダーの決定時に確認する。
- iPadで扱うメディア: 写真撮影、動画撮影、音声録音、既存ファイル追加、プレビュー/再生、個別削除。音声はアプリ内で録音の開始・停止・再生・削除ができる。
- 動画は、iPad/Safariの実機で可能な範囲で、PC互換のMP4/H.264を優先する。実際の形式は実機で確認する。
- 大きな動画はチャンク分割する。通信が中断した場合は、最後に確認済みのチャンクから再開できる。
- Safariの制約により、送信中は「送信完了までこの画面を閉じないでください」と表示する。
- ローカル一時保管の候補はOPFS（blob本体）とし、メタデータは別に管理する。状態は次のとおり: 未送信 / 送信中 / クラウド送信済み / 技工所受領待ち / 技工所受領済み / 削除可能。

### 15.6 manifestと完全性

`manifest.json` は少なくとも次を持つ。

- `schemaVersion`
- `workOrderRef`
- 作成日時
- 添付ID
- メディア/ファイル種別
- MIME
- サイズ
- SHA-256
- 必要なチャンク情報。チャンクの欠落・順序入替・差替えを検出できる構成とする。

技工所PCは、改ざん・欠落・チャンクの順序入替や差替え・ハッシュ不一致・未登録または失効した送信元のいずれかを検出した場合、受領を拒否する（fail closed）。

### 15.7 技工所PCの受信手順

1. 未受領分を確認する
2. ダウンロードする
3. 署名を検証する
4. 復号する
5. SHA-256とチャンクを検証する
6. ローカルへ保存する
7. 受領完了を記録する
8. クラウド上の暗号文を削除する

### 15.8 技工所PC側の保存

- メディア本体はファイルとして保存し、SQLiteのblobには入れない。将来のDBには、パス・ハッシュ・種別・受領日時などのメタ情報だけを保持する。
- 保存構成の例:

```text
DWO_DATA/
  <workOrderRef>/
    work-order.json
    manifest.json
    media/
      photo_001.jpg
      video_001.mp4
      audio_001.m4a
```

- PDFにはメディア本体を埋め込まず、写真・動画・音声の件数または有無だけを表示する。
- ZIPは通常運用の経路にしない。通信障害・緊急復旧・データ救出・移行に限定する。

### 15.9 クラウド候補と人間確認

- クラウドの候補はGoogle Cloud / Firebaseだが、**正式採用ではない**。候補リージョン `asia-northeast1` も最終決定ではない。
- 候補サービス: 暗号化チャンクの保存にCloud Storage / Firebase Storage、最小限の配送メタデータのみFirestoreまたは同等品。
- Phase 5の直前に、人間が次を確認する: プロバイダー採用、Blaze/従量課金、予算アラート/上限、利用規約、最新の医療情報システムの安全管理ガイドライン、保存リージョン、保持期限、医院への説明・運用合意。課金の有効化は常に人間の確認を要する。
- この確認前に課金を有効化せず、実データを扱わない。

### 15.10 ロードマップ

| Phase | 内容 |
| --- | --- |
| 0 | 設計凍結（本節） |
| 1 | iPadメディアUI |
| 2 | ローカル添付管理 |
| 3 | パッケージ / 完全性 / チャンク再開 |
| 4 | ペアリング / 暗号 / 署名 / 失効 / 鍵更新 |
| 5 | 暗号化クラウド中継 |
| 6 | 技工所PC自動受信 |
| 7 | 受領確認と削除 |
| 8 | PC閲覧、納品書・請求アプリ連携 |

### 15.11 Phase 0の完了条件

本節が上記の境界を矛盾なく記録していること、`git diff --check` がPASSすること、アプリコード・既存挙動・実データ・secretsを変更/追加していないこと。現行実装の「外部クラウドへ送信しない」は、後続Phaseが個別に実装・承認されるまで維持する。

### 15.12 Phase 1の実装事実（Issue #117）

Phase 0の境界（15.1〜15.11）は変更しない。Phase 1は医院側「参考資料」（旧 `ref-media` 入力）を置き換えるiPadメディアUIで、ブラウザ内の一時メモリと Object URL だけを使う。

- 実装は `media.js`（`globalThis.ReferenceMediaManager` に純粋helperを公開）、`index.html` の参考資料カード、`style.css` の `.media-*` スタイル。`app.js` は変更しない。
- 操作は「写真を撮る」（`image/*` + `capture=environment`）、「動画を撮る」（`video/*` + `capture=environment`）、「音声を録音」（`getUserMedia` + `MediaRecorder`）、「ファイルから追加」（複数選択）の4つ。
- 種別は `image / video / audio / file`。MIMEは `File.type` / `blob.type` をそのまま保持し、MP4・m4aへ変換・偽装しない。未知MIMEは `file`。
- 一覧は種別・名前・サイズ・MIMEを表示し、各項目を個別削除できる。削除・`pagehide` 時に Object URL を revoke し、録音中の `pagehide` ではトラックを停止する。端末元ファイルは削除しない。
- 添付は `localStorage` / `sessionStorage` / IndexedDB / Cache Storage へ保存しない。`collectFormData()` へも含めない。`workOrderRef` への紐付けと永続化はPhase 2以降。
- 患者名・医院名は添付名・ID に使わない。録音名は日時のみ（例: `音声録音_YYYYMMDD-HHMMSS.webm`）。
- 「送信完了までこの画面を閉じないでください」は非表示要素として用意のみ。送信処理はPhase 5。
- iPad Safariの実機確認（カメラ/動画capture、マイク権限、録音再生、見た目）は未確認。

### 15.13 Phase 2の実装事実（Issue #119）

Phase 0の境界（15.1〜15.11）と15.12のUI仕様は変更しない。15.12の「永続化しない」はPhase 1時点の記述で、Phase 2で下記のローカル永続化を追加した。外部通信・暗号化・署名・SHA-256・manifest・chunk・クラウド・PC受信は実装していない。

- 実装は新規 `media-storage.js`（`globalThis.ReferenceMediaStorage`。永続化・metadata・owner管理）と `media.js`（UI・録音・Object URL・`ReferenceMediaManager.commitCurrentDraft` / `hasAttachments`）。`index.html` は `media-storage.js` を `media.js` の前に1回読み込む。
- Blob本体はOPFSの固定パス `dwo-media-v1/blobs/<attachmentId>` に保存する。`attachmentId` は `att-<uuid-v4>` の非機微なランダムIDで、元ファイル名・患者・医院・workOrderRefを物理パスに使わない。owner変更でファイルは移動しない。
- metadataはIndexedDB `dwo_media_v1`（version 1）。`attachments`（keyPath `attachmentId`、index `ownerRef`）と `settings`（keyPath `key`、`activeDraft`）。metadataは `schemaVersion` `attachmentId` `ownerType` `ownerRef` `status` `source` `kind` `name` `mime` `size` `createdAt` `opfsName` の12項目のみで、Blob・Object URL・患者名・医院名などの未知プロパティは不正として扱う（fail closed）。
- statusは `unsent / sending / cloud_uploaded / lab_receipt_pending / lab_received / deletable` の6種のみ有効で、不明値は拒否する。Phase 2で作る新規添付は `unsent`（未送信）のみ。状態遷移UI・送信処理はない。
- 受注確定前の所有者は `draft:<uuid-v4>`（active draft。IndexedDB `settings` に保存し、`crypto` で生成。生成できなければ永続化不可として安全側に倒す）。
- 追加は「OPFS書込 → metadata書込」の順。OPFS失敗時はmetadataを作らず、metadata失敗時はOPFSをbest-effortでrollbackする。保存成功後にだけ一覧へ出す。
- 削除は「metadata削除 → OPFS削除（best-effort）」。OPFS削除に失敗したファイルはorphanとして残り得るが、metadataが無いため復元・送信対象にならない。端末元ファイルには触れない。
- 起動時は active draft の添付だけを復元する。metadataは厳密検証し、OPFSファイルが欠落したmetadataは削除して一覧に出さず、metadataのないOPFS orphanは復元しない。復元後も表示はPhase 1と同じカード。
- 受注確定（`app.js` の送信処理）は、validate → `workOrderRef` 生成（既存順序を維持）→ `await ReferenceMediaManager.commitCurrentDraft(workOrderRef)` → `state.orders.unshift` の順。commitは1つのIndexedDB transactionで、draft所有の全metadataを `ownerType='work-order'` / `ownerRef=workOrderRef` へ更新し、active draftを新規draftへ更新する。添付が1件以上あり保存未完了・失敗・非対応の場合は受注へ反映せず、フォームと添付を保持して日本語エラーを表示する。添付0件の受注は従来どおり反映できる。commit成功後の `state.orders` 反映は例外を出さない既存best-effort処理を前提とし、rollback receiptは設けない（documented invariant）。送信処理中の二重クリックは `submitInFlight` で無視する。
- OPFS（メインスレッドの `createWritable`）またはIndexedDBが使えない環境では、Phase 1同様にメモリ内添付だけ使える。ただし添付が1件以上ある場合は「このブラウザでは添付を安全に保存できないため受注へ反映できません」を表示して受注確定をfail closedにする。
- `pagehide` はObject URLと録音trackだけを解放し、OPFS・metadataは消さない。
- fail closed（監査指摘対応）: 保存に失敗した添付は未保存項目として画面内に残し（persistedIdsへ入れない）、受注確定は拒否する。削除するか再追加すれば進める。active draftに不正metadata（未知status・未知プロパティ・形式不正・owner不一致）が1件でもあれば `MEDIA_STORAGE_INVALID` で中止し、valid行の移動もactive draftの更新も行わない。OPFSファイルの欠落・sizeとmetadata.sizeの不一致も紐付け前に中止する。復元時も要求ownerの不正metadataは黙って捨てず失敗とし、欠落ファイルは件数を画面に表示する。永続化可能なら添付0件でも紐付け処理を呼びactive draftを更新する。永続化不可で添付0件なら従来フロー、添付ありならfail closed。
- 参考資料カードの案内文は「この端末内に一時保存されます。外部には送信されません。」へ更新した。
- 自動確認: `tests/media-storage.test.js`（Node。memory adapter）と `tools/media-storage-e2e.mjs`（headless ChromeでOPFS+IndexedDBの追加→再読込→復元→削除→commitを確認）。iPad Safariでの実機確認（OPFS書込対応を含む）は未実施。
