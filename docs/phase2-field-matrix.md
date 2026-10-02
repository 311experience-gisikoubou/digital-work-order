# Phase 2 Field Matrix

凡例: **維持**=現行をそのまま使用、**追加保存**=入力/計算は既にあるが受注へ保存されていない、**修正**=現行反映漏れを直す、**新状態**=U01〜U06で確定した追加仕様。

| 領域 | 項目 / 現行キー | 入力 | 下書き | 発行order | PDF | 納品JSON v1 | Phase 2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 医院 | `clinicName` | 必須 | 保存 | 保存 | 表示 | 表示 | 維持 |
| 医院 | `doctorName` | 必須 | 保存 | 保存 | 表示 | 表示 | 維持 |
| 患者 | `patientName` | 必須 | 保存 | 保存 | 表示 | 表示 | 維持 |
| 患者 | `patientAge` | 任意 | 保存 | 保存 | 表示 | 非出力 | 維持 |
| 患者 | `patientGender` | 任意 | 保存 | 保存 | 表示 | 非出力 | 維持 |
| 日付 | `issueDate` | 自動/入力 | 保存 | 保存 | 発行日 | sourceIssueDate | 維持 |
| 日付 | `shippingDate` | 既存 `#shipping-date` | 保存 | **追加保存** | **表示** | 非出力 | U06 |
| 日付 | `deliveryDate` | 必須 | 保存 | 保存 | 表示 | dueDate | 維持 |
| 日付 | `nextAppointment` | 任意 | 保存 | 保存 | 表示 | 非出力 | 維持 |
| 納期 | `standardDeliveryDate` | 既存計算 | 保存 | **追加保存** | 必要時補助 | 非出力 | U06 |
| 納期 | `businessDaysFromShipping` | 既存計算 | 保存 | **追加保存** | 必要時補助 | 非出力 | U06 |
| 納期 | `expediteFeeYen` | 既存計算 | 保存 | **追加保存** | **表示** | 非出力 | U06 |
| 区分 | `insuranceType` | 保険/自費 | 保存 | 保存 | 表示 | classification | 維持 |
| 区分 | `priority` | 通常/急ぎ | 保存 | 保存 | 表示 | 非出力 | 維持。料金と混同しない |
| 発注 | `orderTypes` | 複数 | 保存 | 保存 | 表示 | order_type | 維持 |
| 発注 | `repairDetail` | 修理時 | 保存 | 保存 | 備考先頭 | repair_detail | 維持 |
| 補綴 | `bedType` | 選択 | 保存 | 保存 | 表示 | bed_type | 維持 |
| 補綴 | `devices` | 複数 | 保存 | 保存 | 表示 | device | 維持 |
| クラスプ | `claspType` + 新 `claspTypes` | 現行UI | 保存 | 保存 | 表示 | 旧値互換 | **修正**: 複数を捨てない |
| バー | `barType` + 新 `barTypes` | 現行UI | 保存 | 保存 | 表示 | 旧値互換 | **修正**: 複数を捨てない |
| バー | `castBarCounts` | 上下数量 | 保存 | 保存 | 上下合計 | cast_bar_count | 維持 |
| 補強 | `reinforcementWireCount` | 数量 | 保存 | 保存 | 表示 | count | 維持 |
| リマウント | `hasRimount/rimountJaws/rimountCount` | 上下 | 保存 | 保存 | `×N` | rimount | 維持 |
| メタル | `hasMetalup/metalupDetail` | 現行UI | 保存 | 保存 | 表示 | metalup | 維持 + 既存入力漏れを修正 |
| 補強床 | `hasKyoko/kyokoDetail` | 現行UI | 保存 | 保存 | 表示 | reinforced_base | 維持 |
| 人工歯 | `toothAnterior` | 選択 | 保存 | 保存 | 表示 | artificial_tooth | 維持 |
| 人工歯 | `toothPosterior` | 選択 | 保存 | 保存 | 表示 | artificial_tooth | 維持 |
| 色調 | `shadeGuide/shadeNumber` | 選択+自由入力 | 保存 | 保存 | 表示 | shade | **修正**: その他を捨てない |
| オプション | `taigoha` | checkbox | 保存 | 保存 | 表示 | opposing_tooth | 維持 |
| オプション | `bite` | checkbox | 保存 | 保存 | 表示 | bite | 維持 |
| オプション | `goaFlag` | checkbox | 保存 | 保存 | 表示 | goa | 維持 |
| 咬合器 | `hasArticulator/articulatorType/articulatorDetail` | checkbox+詳細 | 保存 | 保存 | 表示 | articulator | 維持 |
| 備考 | `remarks` | 自由入力 | 保存 | 保存 | 表示 | remarks | 維持。500字制限を新設しない |
| 歯式 | `teeth[FDI].baseState` | 図/数字 | 保存 | snapshot | 表示 | missingのみ互換 | **新状態** U03 |
| 歯式 | `teeth[FDI].caution` | 図/数字 | 保存 | snapshot | 表示 | 非出力 | **新状態** U03 |
| 歯式 | `selectedTeeth` | 派生 | 保存 | 互換保存 | 欠損表示 | sourceTeeth | 維持/派生 |
| 歯式 | 18/28/38/48 | 図/数字 | 保存 | snapshot | **必ず反映** | missingならsourceTeeth | U06 |
| 歯式 | `coordinates` | 座標修正 | 保存 | snapshot | 対象受注から描画 | 非出力 | 追加snapshot |
| クラスプ図 | `claspState` | 既存配置 | 保存 | snapshot | 対象受注から描画 | 非出力 | 追加snapshot |
| 手書き | `drawStrokes` | Pencil/指/マウス | 保存 | snapshot | 対象受注から描画 | 非出力 | 追加snapshot |
| 手書き | `memoStrokes` | Pencil/指/マウス | 保存 | snapshot+旧値 | 対象受注から描画 | 非出力 | 維持/固定 |
| 添付 | 写真 | capture/file | ownerRef | workOrderRef紐付け | 本体埋込なし | 非出力 | PR #120再利用候補 |
| 添付 | 動画 | capture/file | ownerRef | workOrderRef紐付け | 本体埋込なし | 非出力 | PR #120再利用候補 |
| 添付 | 音声 | MediaRecorder | ownerRef | workOrderRef紐付け | 本体埋込なし | 非出力 | HTTPS/iPad gate継続 |
| 添付 | 既存ファイル | file picker | ownerRef | workOrderRef紐付け | 本体埋込なし | 非出力 | PR #120再利用候補 |
| 下書き | `draftRef` | 自動 | 端末local | 発行成功で終了 | 非表示 | 非出力 | **新規** U01 |
| 発行 | `workOrderRef` | secure自動 | 未生成 | 1回生成 | 再PDFで再利用 | stable ref | 維持 |
| 受注 | `status` | 受付操作 | 対象外 | pending/accepted | 非表示 | 非出力 | 維持 |
| OCR | 紙画像/候補 | 既存 | **保存しない** | 承認値だけフォームへ | 従来どおり | 従来どおり | 維持 |

## 反映漏れの扱い

Phase 2実装では、画面に存在する既存値を「現行orderへ入っていないから不要」と判断しない。
特に、複数クラスプ/バー、上下/数量、色調その他、メタルアップ等は、現行DOMと既存業務意味を確認して**入力 → 下書き → 発行order → 詳細 → PDF**の経路をつなぐ。

## 必須項目

既存 `validate.js` の4項目を維持する。

1. 歯科医院名
2. 担当歯科医師
3. 患者名
4. 納期

Phase 2仕様だけを理由に新しい必須項目を増やさない。
