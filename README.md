# デジタル指示書
デジタル歯科技工指示書

---

## 動作確認方法

### 重要：正しい ZIP の取得方法

**main ブランチの "Download ZIP" は使わないでください。**
古いファイルが含まれており、ブラウザキャッシュと合わさって動作しないことがあります。

作業ブランチの ZIP を直接取得してください：

1. GitHub でブランチ `claude/fix-browser-cache-PAZUe` を開く
2. Code → Download ZIP を選択
3. 展開後、`ccbdbadb-shijishov5.3.html` をブラウザで開く
4. **Ctrl+F5（強制再読み込み）を必ず実行**してから確認する

### 動作確認チェックリスト

- [ ] 新規送信できるか
- [ ] 受注タブが表示されるか
- [ ] 受付ボタンが動くか
- [ ] 詳細表示が動くか
- [ ] PDF 出力が動くか
- [ ] Console に赤エラーが出ないか

※ `file://` 起動時の Chrome 制限系警告（CORS など）は動作に影響しない。

### 安定バージョン

| 種別 | コミット | 内容 |
|---|---|---|
| 現在の安定版 | `31bd951` | renderOrders / acceptOrder を orders.js に分離 |
| fallback | `41501f4` | shade-guide / shade-number の null 安全修正 |

問題が発生した場合は `41501f4` のファイル群に戻してください。
