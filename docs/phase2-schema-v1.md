# Phase 2 Schema v1

## 1. 方針

Phase 2は既存データを置換せず、**追加schema + 互換派生値**で進める。
`dwo_drawing_v1`、`dwo_clasp_v1`、`dwo_session_orders_v1`、`digital-work-order-intake-v1` は削除しない。

## 2. 下書き envelope

保存キー: `dwo_form_draft_v1`

```json
{
  "schemaVersion": "dwo-form-draft-v1",
  "draftRef": "draft:<uuid-v4>",
  "savedAt": "RFC3339",
  "form": {},
  "visualSnapshot": {},
  "mediaOwnerRef": "draft:<same-uuid-v4>"
}
```

### 規則

- Phase 2ではactive draftは1件。
- `draftRef` と `mediaOwnerRef` は同一値。
- UUIDはsecure randomで生成する。
- Blob/Object URL/PDF/OCR一時画像を入れない。
- 未知version、不正型、未知トップレベル必須値は部分復元しない。
- 保存成功を確認できない限り「下書き保存済み」と表示しない。
- 自動TTLは設けない。削除条件は発行成功または利用者の明示破棄。
- storage利用不可時はfail closedで保存失敗を返し、入力値を消さない。

## 3. form object

`form` は、現在のフォームへ戻すための論理入力値を保持する。既存 `collectFormData()` と名称を合わせる。

主な既存キー:

```text
clinicName, doctorName, patientName, patientAge, patientGender, issueDate
insuranceType, orderTypes, repairDetail
bedType, devices
claspType, barType, castBarJaws, castBarCounts
reinforcementWireCount
hasRimount, rimountJaws, rimountCount
hasMetalup, metalupDetail
hasKyoko, kyokoDetail
toothAnterior, toothPosterior, shadeGuide, shadeNumber
taigoha, bite, goaFlag
hasArticulator, articulatorType, articulatorDetail
deliveryDate, nextAppointment, priority, remarks
```

Phase 2で追加して発行時にも保持するキー:

```json
{
  "shippingDate": "YYYY-MM-DD",
  "standardDeliveryDate": "YYYY-MM-DD",
  "businessDaysFromShipping": 11,
  "expediteFeeYen": 0
}
```

- `shippingDate`: 既存 `#shipping-date` / `shippingDateGlobal` の値。
- `standardDeliveryDate`: 既存 `stdDeliveryDate`。
- `businessDaysFromShipping`: 現行 `countBizDays()` の結果。
- `expediteFeeYen`: 現行 `applyDelivery()` が算出する金額。
- これらの追加は既存料金計算式を変更するものではない。

## 4. 歯状態

canonical shape:

```json
{
  "18": {
    "baseState": "normal",
    "caution": false
  },
  "17": {
    "baseState": "missing",
    "caution": true
  },
  "16": {
    "baseState": "abutment",
    "caution": false
  }
}
```

### 制約

- `baseState` は `normal | missing | abutment` の3値のみ。
- `caution` はboolean。
- 欠損と支台歯を別booleanで同時trueにしない。
- `selectedTeeth` は `baseState === "missing"` のFDI番号から派生する互換値。
- FDI番号はcanonical JSONにある32歯だけを許可する。

## 5. visualSnapshot

schemaVersion: `dwo-visual-snapshot-v1`

```json
{
  "schemaVersion": "dwo-visual-snapshot-v1",
  "teeth": {},
  "selectedTeeth": [17],
  "claspState": {},
  "drawing": {
    "strokes": [],
    "memoStrokes": []
  },
  "coordinates": {
    "18": {"cx": 95, "cy": 462, "rx": 38, "ry": 38}
  }
}
```

### 規則

- 発行時にdeep copyして以後変更しない。
- `selectedTeeth` は互換用派生値であり、歯状態の正本ではない。
- `claspState` は既存構造をそのままsnapshotする。内部キーの意味を変更しない。
- `drawing.strokes` と `drawing.memoStrokes` は既存 `dwo_drawing_v1` と同じstroke構造を使う。
- `coordinates` は発行時の32歯座標。未編集でもcanonical座標を保持してよい。
- PDFは対象orderの `visualSnapshot` を使う。

## 6. 発行済みorderへの追加

既存order objectへ次を追加する。

```json
{
  "workOrderRef": "dwo:<uuid-v4>",
  "shippingDate": "2026-10-02",
  "standardDeliveryDate": "2026-10-20",
  "businessDaysFromShipping": 8,
  "expediteFeeYen": 3000,
  "visualSnapshot": {
    "schemaVersion": "dwo-visual-snapshot-v1"
  }
}
```

既存キー `selectedTeeth` と `memoStrokes` は互換のため当面維持する。
新旧の値は同じ発行snapshotから生成し、別タイミングで独立更新しない。

## 7. 複数選択の互換拡張

現行UIで複数選択可能だが単一値しか保存していない項目は、配列を追加し旧単一値も維持する。

```json
{
  "claspTypes": ["ワイヤー鉤", "キャスト鉤"],
  "claspType": "ワイヤー鉤",
  "barTypes": ["キャストバー", "屈曲バー"],
  "barType": "キャストバー"
}
```

- 配列が正本。
- 旧単一値は配列先頭から生成する互換値。
- 旧orderを読むときは単一値しかなければ1要素配列として扱う。
- 実際の画面値/内部キーは現行DOM・既存コードを再利用し、schema例の文字列を新しい業務選択肢として追加しない。

## 8. メディアmetadataとの関係

PR #120を再利用する場合:

- Blob: OPFS `dwo-media-v1/blobs/<attachmentId>`
- metadata: IndexedDB `dwo_media_v1`
- draft owner: `ownerType=draft, ownerRef=draftRef`
- 発行時: `ownerType=work-order, ownerRef=workOrderRef`
- フォームdraft側にBlob/metadataを重複保存しない。

## 9. delivery-intake-v1

既存出力schemaは変更しない。

```text
schemaVersion = digital-work-order-intake-v1
workOrderRef = existing stable ref
sourceTeeth = derived selectedTeeth
sourceInstructions = existing mapper
```

Phase 2の `visualSnapshot`、`shippingDate`、`expediteFeeYen` を下流へ渡す必要が後から確定した場合だけ、新versionまたは明示的な後方互換拡張を設計する。

## 10. versioning

- draft: `dwo-form-draft-v1`
- visual snapshot: `dwo-visual-snapshot-v1`
- current order session: `dwo-session-orders-v1` を維持し、validatorだけ新規optional fieldsを許容する。
- delivery intake: `digital-work-order-intake-v1` を維持。
- media metadata: PR #120の `dwo-media-meta-v1` を再利用候補とする。
