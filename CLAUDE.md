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
