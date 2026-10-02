# Phase 2 Compatibility / Change Scope

## 1. 結論

Phase 2は**既存機能の置換ではなく、保存・snapshot・反映漏れを補う最小変更**で実装する。
既存キー、PDF外形、休日/急ぎ計算、delivery-intake-v1を壊さない。

## 2. 変更予定ファイル

| ファイル | 目的 | 変更の種類 |
| --- | --- | --- |
| `index.html` | 下書き保存、発行フロー、歯式拡大/状態UIの既存カード接続 | 最小DOM変更 |
| `app.js` | 下書き収集/復元、発行snapshot、shipping/fee収集、発行順序 | 既存処理拡張 |
| `tooth-chart.js` | missing/abutment/cautionの単一状態、snapshot/restore、図・数字・拡大同期 | 状態整理 |
| `orders.js` | 新optional fields/visualSnapshotのsession validator、対象order再PDF | 後方互換拡張 |
| `pdf.js` | order snapshot描画、8–8、発送日、急ぎ料金、2件独立描画 | 内部描画修正 |
| `modal.js` | 詳細PDFへ対象order IDを確実に渡す | 小修正 |
| `delivery-intake-export.js` | 原則変更なし。既存v1互換テスト追加のみを優先 | 保護対象 |
| `calendar.js` | 計算式は変更せず、結果を安全に取得できるhelperが必要な場合のみ | 最小抽出 |
| `media.js` / PR #120 `media-storage.js` | draftRef一本化、発行時workOrderRef紐付け | PR整合 |
| `style.css` | 採用カード内の表示/拡大。外側配置はcanonical維持 | UI実装 |
| tests | draft、歯状態、snapshot、PDF、互換性 | 追加 |

実装前のdiff調査で不要と判明したファイルは変更しない。

## 3. 追加する正本ファイル

- `docs/phase2-input-save-output-spec.md`
- `docs/phase2-field-matrix.md`
- `docs/phase2-schema-v1.md`
- `docs/phase2-compatibility-change-scope.md`
- `docs/canonical/business-layout-20261001-toothchart-compact-sync-v1.json`
- `docs/canonical/tooth-chart-sync-spec-v1.json`

canonical JSON 2ファイルは採用済み原本をbyte内容の変更なしで取り込む。

## 4. 保護対象

### 変更しない / 削除しない

- `dwo_drawing_v1`
- 既存stroke構造 `{strokes, memoStrokes}`
- `dwo_clasp_v1`
- `dwo_session_orders_v1`
- stable `workOrderRef` 形式
- `digital-work-order-intake-v1`
- B5 182×257mm / A4 210×297mm
- B5上下2面
- ローカル同梱 html2canvas / pdf-lib / OCR assets
- 休日判定
- 保険11営業日 / 自費14営業日
- 現行急ぎ料金式
- 紙指示書OCRの明示承認・照合・成功後破棄
- 承認済み歯形態と32歯座標

### 新規追加

- `dwo_form_draft_v1`
- `dwo-visual-snapshot-v1`
- tooth `baseState/caution`
- shipping/fee snapshot fields

## 5. 旧データの読み方

### 5.1 旧order

`visualSnapshot` がないorder:

- `selectedTeeth`, `memoStrokes`,既存テキスト項目は従来どおり読む。
- 現在画面の `toothState`, `claspState`, `drawStrokes` を旧orderのものとして代用しない。
- 無い図情報は「情報なし」とする。
- 旧orderの読み込みだけを理由にデータmigrationを要求しない。

### 5.2 旧クラスプ/バー

- 新配列がない場合は旧単一値を1要素配列として解釈する。
- 新orderでは配列を正本にし、旧単一値を互換出力として派生する。

### 5.3 旧歯式

- 旧 `selectedTeeth` は全て `baseState=missing` として解釈できる。
- 旧データにはabutment/cautionの完全snapshotがない場合があるため、存在しない状態を推測しない。

## 6. PR #120との整合

PR #120は現在Draft/open/unmerged。

取り込み時のルール:

1. 最新mainから差分を再確認する。
2. OPFS/IndexedDBの既存実装を優先して再利用する。
3. PR #120独自のactive draft IDと `dwo_form_draft_v1.draftRef` を二重化しない。
4. 添付あり発行では、PDF準備前後の順序をPhase 2発行フローへ合わせる。
5. 保存失敗、不正metadata、OPFS欠落/size不一致のfail-closedを弱めない。
6. 過去テスト結果を再利用せず、統合後HEADで再実行する。
7. クラウド、暗号、送信は追加しない。

## 7. 実装順序

最小変更 → 確認 → 次の変更で進める。

1. **保存基盤**: form draft schema + save/restore + strict validation
2. **歯状態**: baseState/caution + existing selectedTeeth compatibility
3. **受注snapshot**: tooth/clasp/drawing/coordsを発行時固定
4. **入力反映漏れ**: 既存DOMから失われている値をorderへつなぐ
5. **発送/急ぎsnapshot**: calendar計算結果の収集のみ追加
6. **PDF**: 対象order snapshot、8–8、発送日、急ぎ料金、2件独立
7. **メディア**: PR #120とdraftRef/発行順序を統合
8. **詳細/JSON互換**: 対象ID、旧order、delivery-intake-v1を確認
9. **採用レイアウト実装**: canonical外側配置を維持し、カード内部だけ接続
10. **自動テスト → iPad主観確認 → final audit**

この順序なら、歯式/PDF/UIを一度に変えて原因が分からなくなることを避けられる。

## 8. 必須自動テスト

- draft save/restore: valid / invalid JSON / unknown version / storage unavailable
- browser restart相当のlocalStorage restore
- missing ↔ abutment排他
- caution重畳
- numeric ↔ diagram ↔ expanded 同期
- selectedTeeth legacy derivation
- order visualSnapshot deep-copy independence
- 2 ordersのsnapshot非混入
- 旧order visualSnapshotなしでcurrent globalを借りない
- shippingDate保存
- expediteFeeYenが現行計算と一致
- PDF 18/28/38/48反映
- PDF 2面外形維持
- repairDetail二重表示なし
- delivery-intake-v1 output unchanged
- dwo_drawing_v1/dwo_clasp_v1互換
- PR #120統合後はmedia persistence/commit/fail-closed再テスト
- `node --check` changed JS
- `git diff --check`
- changed-file/unintended-diff audit

## 9. 人間確認を残すもの

実装後、人間に残すのは次だけ。

- iPadでのカード密度・文字サイズ・見た目
- 小型歯式 → 拡大編集の操作感
- Apple Pencil/指の主観的操作感
- 最終的な業務上の違和感
- merge許可

DOM値、保存復元、PDF項目有無、schema、Git状態、テスト結果はAI側で確認する。
