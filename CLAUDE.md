# Project Rules

## 目的
単一HTMLだった歯科技工作業指示書を、安全にモジュール分離しながら保守可能にする。

## 現在構成
- ccbdbadb-shijishov5.3.html
- style.css
- app.js
- calendar.js
- pdf.js

## 絶対禁止
- 関数名変更
- 変数名変更
- class/id変更
- ロジック変更
- AI判断による最適化
- 重複統合
- 自動リファクタリング

## 許可
- 単純移動
- ファイル分離
- import/export追加
- script/link追加

## Thinking推奨
- 状態管理変更
- SVG歯式図
- クラスプ
- Firebase
- 保存機能
- 大規模仕様変更

## 最大危険箇所
- state.selectedTeeth
- toothState

二重状態管理になっているため慎重に扱う。

## Git運用
毎回：
1. git status
2. 小さい修正1つ
3. 動作確認
4. git commit

---

## 現在の安定状態

### 採用コミット
- **安定版**: `31bd951`（ブランチ: `claude/fix-browser-cache-PAZUe`）
- **fallback**: `41501f4`（ブランチ: `claude/create-claude-md-kZVaJ`）

`41501f4` には手を加えない。問題発生時の戻し先として保持する。

---

## ファイル構成・分離状況

### 分離済み（変更不要）

| ファイル | 収録内容 |
|---|---|
| `toast.js` | `showToast()` |
| `validate.js` | `validate()` |
| `date-utils.js` | `formatDateLabel()` |
| `modal.js` | `showDetail()` |
| `pdf.js` | `exportPDF()` |
| `tooth-chart.js` | 歯式描画系 |
| `calendar.js` | カレンダー系 |
| `orders.js` | `updateSummary()` / `renderOrders()` / `acceptOrder()` |

### app.js に残しているもの（現時点で分離しない）

- `state`（グローバル変数）
- `collectFormData()`
- `resetForm()`
- タブ切り替え・保険/自費切り替え・トグル・展開エリア制御
- `initDates()`・submit-btn イベント

### collectFormData() の分離方針

**現時点では分離しない。**

理由：
- DOM ID 依存が 20 箇所超
- HTML ファイル（812KB）に script タグ追加が必要になる
- 分離効果が限定的
- 実ブラウザ確認後の安定を優先

---

## script 読み込み順（ccbdbadb-shijishov5.3.html）

```
toast.js
date-utils.js
tooth-chart.js
validate.js
app.js          ← state はここで宣言される
orders.js       ← renderOrders / acceptOrder はここ
modal.js
pdf.js
calendar.js
```

この順序を変えないこと。`orders.js` は必ず `app.js` の後に置く。

---

## 作業ルール

- **1変更1確認**：コミット前に必ずブラウザ確認
- **ZIP は作業ブランチから取得**：main の Download ZIP は使わない
- **Ctrl+F5 必須**：古いキャッシュを読まないように強制再読み込み
- **変更前に依存関係調査**：DOM 依存・state 依存・script 順を先に確認
- **分離より動作安定優先**：動くコードをリスクなしに壊さない
- **調査のみ指示には絶対従う**：「まず調査だけ」と言われたら変更しない

---

## 今後触らない方がいいもの

- `collectFormData()`（DOM 依存強すぎ）
- `ccbdbadb-shijishov5.3.html` の script タグ順序
- `41501f4` のファイル群（fallback として保持）
- `state` の構造（全ファイルが依存）
