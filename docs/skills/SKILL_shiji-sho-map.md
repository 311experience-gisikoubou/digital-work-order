# SKILL_shiji-sho-map — 歯科技工指示書アプリ 現状マップ

> **用途**：新チャット開始時または Claude Code 引き継ぎ時にこのファイルを読み込んで現状を把握するためのリファレンス。
> **最終照合日**：2026-06-15
> **対象ブランチ**：`claude/redesign-dental-form-qG3Ue`

---

## 1. プロジェクト概要

歯科技工所向けのデジタル作業指示書 Web アプリ。
iPad Safari + Apple Pencil での現場利用を主目的とし、PDF 出力・受注管理・歯式図手書きを備える。
データ保存は現在 localStorage（Firebase 連携は未着手）。
ホスティングは Cloudflare Pages 導入予定。

---

## 2. ⚠️ 旧前提の訂正（重要）

**`shiji-sho-v5.html` というファイルは存在しない。**

リポジトリには以下のファイルがあるが、これらはアップロード時のコピー版であり現状マップの基準にしない：

```
shiji-sho-v5 (1).html
shiji-sho-v5 (1) (2).html
shiji-sho-v5.3 (1).html
```

**現在の実働入口は `index.html`。**
アプリのコードはすべて分割構成（後述）に移行済み。

---

## 3. 現在のファイル構成

| ファイル | 行数 | 役割 |
|---|---|---|
| `index.html` | 883 | アプリ本体 HTML。script / link タグの読み込み順を管理 |
| `app.js` | 320 | `state` 定義・タブ切替・保険/自費切替・`collectFormData()`・`resetForm()`・`initDates()`・送信処理 |
| `style.css` | 741 | 全スタイル |
| `tooth-chart.js` | 1282 | 歯式図 SVG 生成・クラスプ管理・手書き描画・消しゴム・保存/復元 |
| `pdf.js` | 333 | `exportPDF()` / `_buildPrintHTML()` — window.print() 方式 |
| `calendar.js` | 258 | 納期カレンダー表示 |
| `orders.js` | 173 | `updateSummary()` / `renderOrders()` / `acceptOrder()` / `cancelOrder()` |
| `validate.js` | — | `validate()` — フォームバリデーション |
| `date-utils.js` | — | `formatDateLabel()` — 日付フォーマット |
| `modal.js` | — | `showDetail()` — 受注詳細モーダル |
| `toast.js` | — | `showToast()` — トースト通知 |

### script 読み込み順（index.html 内で順守）

```
toast.js
date-utils.js
tooth-chart.js
validate.js
app.js          ← state はここで宣言
orders.js       ← renderOrders / acceptOrder はここ
modal.js
pdf.js
calendar.js
```

この順序を変えてはいけない。`orders.js` は必ず `app.js` の後。

---

## 4. state 構造

`app.js` の先頭で宣言。全ファイルから参照される。

```javascript
const state = {
  selectedTeeth: new Set(),          // 欠損選択歯番号（number の Set）
  insuranceType: 'insurance',        // 'insurance' | 'jishi'
  priority: 'normal',                // 優先度（現状未使用）
  orders: []                         // 受注一覧（Firebase 連携予定、現在 localStorage 代替）
};
```

### 二重状態管理（最大危険箇所）

`state.selectedTeeth`（歯チャート側）と `toothState`（歯式図 SVG 側、tooth-chart.js 内）が並存している。
どちらかを変更するときは両方の同期が必要。むやみに触らない。

---

## 5. insuranceType / insKey / DOM ID の注意点

### 変換コード（app.js L120–121）

```javascript
const ins = state.insuranceType;          // 'insurance' | 'jishi'
const insKey = ins === 'insurance' ? 'ins' : 'jishi';
```

**変数名は `insKey`（`insId` ではない）。**

### DOM ID の組み立てパターン

`insKey` を suffix として使い、保険/自費で異なる要素を切り替える：

```javascript
document.getElementById(`chk-metalup-${insKey}`)    // 'chk-metalup-ins' | 'chk-metalup-jishi'
document.getElementById(`metalup-${insKey}-detail`)  // 'metalup-ins-detail' | 'metalup-jishi-detail'
document.getElementById(`chk-kyoko-${insKey}`)
getToggleVal(`clasp-ins`)  / getToggleVal(`clasp-jishi`)
getToggleVal(`bar-ins`)    / getToggleVal(`bar-jishi`)
getToggleVal(`bed-insurance`) / getToggleVal(`bed-jishi`)   // ← bed のみ 'insurance' 文字列をそのまま使用
```

`bed-insurance` / `bed-jishi` は `insKey` ではなく `ins` をそのまま使っている（例外）。

---

## 6. クラスプ略号対応表

`tooth-chart.js` の `CLASP_LABELS` / `CLASP_COLORS` / `CLASP_NAMES` に基づく。

| 内部キー | 歯式図表示 | 日本語名 | 色 |
|---|---|---|---|
| `W` | W | W ワイヤークラスプ | #2563a8（青） |
| `E` | C | C キャスト鉤 | #22aa66（緑） |
| `T` | T | T 双子鉤 | #8844cc（紫） |
| `R` | R | R レスト | #dd7700（橙） |
| `H` | H | H フック | #cc2222（赤） |
| `C` | CM | CM コンビ鉤 | #8B4513（茶） |
| `I` | I | I Iバー | #0088aa（水） |
| `WI` | WI | WI ワイヤーIバー | #0088aa（水） |

**よくある誤り：**
- `E` は「キャスト鉤」（歯式図上表示は `C`）、`W` は「ワイヤークラスプ」。E と W を逆に書かないこと。
- `B` という内部キーは存在しない。
- `T`（双子鉤）だけ2歯クリックが必要な特殊フロー（`twinFirst` 変数で管理）。

### claspState の構造（tooth-chart.js）

```javascript
claspState = {
  [歯番号]: [
    { uid, type, dir, isTwin1, twinWith, cx, cy }
    // type は上記内部キー ('W'|'E'|'T'|'R'|'H'|'C'|'I'|'WI')
    // cx, cy は SVG 座標上の位置（ドラッグ移動可能）
  ]
};
claspMode = { type, dir };  // 現在選択中のクラスプモード。null = 未選択
```

localStorage 保存キー：`dwo_clasp_v1`

---

## 7. 手書き機能（tooth-chart.js）

### 歯式図手書き（左側 SVG: `#toothSvg`）

| 変数 | 役割 |
|---|---|
| `drawMode` | 手書きモード ON/OFF |
| `drawStrokes` | 歯式図上の全ストローク配列 |
| `eraserMode` | 消しゴムモード |
| `eraserRadius` | 消しゴム半径（小:8 / 中:20 / 大:36） |
| `drawHistory` / `drawRedoStack` | Undo/Redo スタック |

### 手書きメモ欄（右側 SVG: `#memoSvg`）

| 変数 | 役割 |
|---|---|
| `memoStrokes` | メモ欄の全ストローク配列 |
| `memoHistory` / `memoRedoStack` | メモ欄の Undo/Redo スタック |
| `lastActiveZone` | `'chart'` or `'memo'` — Undo/Redo の対象ゾーン |
| `memoEraserCursorEl` | メモ欄の消しゴムカーソル SVG 要素 |

### localStorage 保存キー：`dwo_drawing_v1`

```javascript
// 保存構造（このキーを変えてはいけない）
{
  strokes: [...],       // 歯式図手書きストローク
  memoStrokes: [...]    // メモ欄ストローク（旧データには存在しない → [] で扱う）
}
```

---

## 8. PDF 出力（pdf.js）

- `exportPDF(id, id2)` — `window.print()` 方式（iframe 使用）。jsPDF は使わない。
- `chartWrap.outerHTML` をそのまま PDF 用 HTML に埋め込む → 歯式図手書き線は自動反映。
- `memoSvg.outerHTML` も同様に埋め込む（ストロークが 1 本以上の場合のみ）。
- PDF は A4 縦 2 枚分（148mm × 2 = 296mm）。1 伝票 = 上下の slip 各 1 枚。

### PDF 内レイアウト構造

```
.slip (148mm × 210mm)
├── .slip-header（発行日・タイトル）
├── .print-body (flex-row, align-items:stretch)
│   ├── .chart-col (68mm, flex-column)
│   │   ├── .chart-wrap (68mm × 110mm) ← 歯式図
│   │   └── .memo-col (flex:1) ← メモ欄（歯式図下の余白全体）
│   └── .info-wrap (flex:1) ← 患者情報・補綴指示
└── .studio-sig（屋号）
```

---

## 9. 納期カレンダー（calendar.js）

- `renderCalendar()` — 受注一覧から納期日を月次カレンダーに表示。
- `state.orders` を参照。

---

## 10. 既知の注意点

1. **二重状態管理**：`state.selectedTeeth`（歯チャート）と `toothState`（歯式図 SVG）は別物。同期関数 `syncToothChart()` / `syncToShijiChart()` で橋渡し。どちらか一方だけ更新するとズレる。
2. **`collectFormData()` は DOM 依存が強い**：20 箇所超の `getElementById` があり分離困難。現状 `app.js` に置いたまま。
3. **index.html は 883 行**：script タグの読み込み順が壊れると全機能停止。追加時は末尾順守。
4. **Firebase 未接続**：送信処理は `state.orders.unshift(data)` のみ（ローカル配列）。ページリロードで消える。Firestore 連携コードはコメントアウト済み。
5. **古い HTML ファイル（shiji-sho-v5 系）**：削除しないこと（fallback / 参照用として保持）。現状の動作には無関係。

---

## 11. 作業時の最重要ルール（CLAUDE.md より抜粋）

| ルール | 内容 |
|---|---|
| 絶対禁止 | 関数名変更・変数名変更・class/id変更・ロジック変更・AI判断による最適化・重複統合・自動リファクタリング |
| 許可 | 単純移動・ファイル分離・import/export追加・script/link追加 |
| 1変更1確認 | コミット前に必ずブラウザ確認 |
| 触らない | `collectFormData()`・index.html の script タグ順序・`state` の構造 |
| 安定 fallback | コミット `41501f4`（ブランチ `claude/create-claude-md-kZVaJ`）は変更禁止 |

---

## 12. ブランチ・コミット運用ルール

- **作業は作業ブランチで行い、確認後に PR 経由で main にマージする**
- Cloudflare Pages が `main` をデプロイソースとする予定のため、main 直接プッシュはリスクあり
- スキルファイル（`docs/` 以下）であっても main 直接コミットは避ける
- 現在の作業ブランチ：`claude/redesign-dental-form-qG3Ue`

### 安定版コミット

| コミット | ブランチ | 内容 |
|---|---|---|
| `31bd951` | `claude/fix-browser-cache-PAZUe` | 採用安定版 |
| `41501f4` | `claude/create-claude-md-kZVaJ` | fallback（変更禁止） |

---

## 13. 新チャット開始用プロンプト

```
以下は歯科技工指示書 Web アプリ（311experience-gisikoubou/digital-work-order）の引き継ぎです。

【現在の構成】
- 実働入口: index.html（分割構成）
- 主要ファイル: app.js / tooth-chart.js / pdf.js / calendar.js / orders.js / style.css
- 作業ブランチ: claude/redesign-dental-form-qG3Ue
- 旧ファイル shiji-sho-v5.html 系は存在しません（index.html が正です）

【絶対禁止】
- 関数名・変数名・class/id の変更
- AI 判断による最適化・リファクタリング
- collectFormData() の分離
- script 読み込み順の変更

【現在の依頼】
（ここに具体的な作業を書く）

まず docs/skills/SKILL_shiji-sho-map.md を読んで現状を把握してから作業してください。
```

---

## 14. 更新履歴

| 日付 | 更新内容 |
|---|---|
| 2026-06-15 | 初版作成。app.js / tooth-chart.js の実コード照合に基づき insKey・クラスプ対応表を確定。旧 shiji-sho-v5.html 前提を訂正。 |
