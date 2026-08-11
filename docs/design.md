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
