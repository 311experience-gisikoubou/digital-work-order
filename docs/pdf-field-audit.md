# PDF Field Reflection Audit

Issue: #28
Branch: `audit/pdf-field-reflection`

## Purpose

入力UI → `collectFormData()` → PDF表示の経路を監査し、反映漏れ・重複表示・旧仕様残存を特定する。

## Confirmed PASS

- 患者・医院情報: `clinicName`, `doctorName`, `patientName`, `patientAge`, `patientGender`
- 区分: `insuranceType`（リマウント時は非表示）
- 発注形態: `orderTypes`
- リマウント咬合調整: `hasRimount`, `rimountCount` → `リマウント咬合調整 ×N`
- 欠損歯: `selectedTeeth`
- クラスプ: `claspType` / `claspState`
- 床種: `bedType`
- キャストバー: `castBarCounts.upper/lower` → 上下合計 `キャストバー ×N`
- 補強線: `reinforcementWireCount` → `補強線 ×N`
- 人工歯: `toothAnterior`, `toothPosterior`
- 色調: `shadeGuide`, `shadeNumber`
- メタルアップ: `hasMetalup`, `metalupDetail`
- 補強床: `hasKyoko`, `kyokoDetail`
- 対合歯 / バイト / GoA: `taigoha`, `bite`, `goaFlag`
- 咬合器: `hasArticulator`, `articulatorType`, `articulatorDetail`
- 備考: `remarks`
- 手書きメモ: `memoStrokes`
- 納品日 / 次回Ap: `deliveryDate`, `nextAppointment`

## Resolved mismatch

### A-01 修理詳細の二重表示

`repairDetail` は修理発注時に備考先頭へ `修理詳細：...` として連結される一方、左列にも `修理詳細` 行として表示されていた。

確定仕様: 修理詳細は備考先頭へ反映。

Implemented fix: `pdf.js` の左列 `row(L, '修理詳細', order.repairDetail)` を削除し、備考先頭への反映のみ残した。

## Protection scope

変更しないもの:
- `dwo_drawing_v1`
- `dwo_clasp_v1`
- 歯式データ構造
- 描画ロジック
- クラスプロジック
- 保存形式

## Verification after implementation

- JavaScript syntax property: `success` by remote-only equivalent evidence. The canonical exact-head diff removes one complete standalone statement only; the literal `node --check pdf.js` command was not run in a local workspace.
- Diff hygiene (`git diff --check` property): `success` by canonical remote diff; the implementation commit is `+0 / -1` in `pdf.js` with no added whitespace.
- changed-file / unintended-diff review: `success`; implementation commit changes only `pdf.js` by one deletion.
- `debug-verification` three-question check: real-device iPad Safari confirmation is `unneeded` for this fix because the intended property (duplicate row removed while remarks rendering remains) is fully determined by exact-head code and canonical diff. No layout/CSS, persistence, drawing, clasp, or tooth-structure change was made.

## Merge

ユーザーの明示指示があるまで merge しない。
