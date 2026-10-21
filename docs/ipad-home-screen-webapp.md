# iPadホーム画面Webアプリの起動設定（2026-10-21）

## 決定範囲

デジタル歯科技工指示書は、これまでどおり**既存のHTML/CSS/JavaScriptによるWebアプリ**とする。iPad横向きでは「ホーム画面に追加」から起動できるよう `manifest.webmanifest` とApple専用メタデータ、採用デザインのロゴ由来のアイコンのみを追加する。**新しいアプリ、外部サービス、有料契約は導入しない。**

これはiPadでSafariのタブとアドレスバーが見えない**standalone表示**を意図した設定であり、iPadOSのステータス表示や安全領域が消える保証はない。Safariのタブで開いた場合は従来どおりSafariのUIが表示される。

- 本番URL（既存GitHub Pages）：`https://311experience-gisikoubou.github.io/digital-work-order/`
- manifestの`start_url`、`scope`、`id`は**相対指定**とし、リポジトリのサブパス配信に対応。公開URLを変更しない。
- `display: standalone` と `apple-mobile-web-app-capable: yes` を併用。
- アイコンは最終採用画像 `docs/canonical/assets/approved-fullscreen-teal-20261021.png` （SHA-256 `8cc77c1fc9d730357c217919c32ce339c679cf02456d3038323a03cc04f6143f`）の左上のロゴから抽出。別のデザインや歯式形態を創作しない。
- UI・入力項目・PDF・下書き・写真・動画・音声・歯式・Apple Pencil・連携処理、データスキーマは変更しない。

## データ保全上の重大な注意

**Safariと、ホーム画面から起動するWebアプリの端末内保存データは分離される。** Apple WebKitの仕様により、Safari側に保存された`localStorage`・IndexedDB・OPFSの下書き・添付は、ホーム画面アプリへ自動移行しない。画面や患者データが消えたと誤認する事故を避ける。

1. **本番切替前に、Safariに編集中の重要な下書きや未発行データが残っていないか確認する。** 確認・整理前にSafari側のデータを削除しない。
2. 新しいホーム画面アプリで表示される空の入力画面は、Safariの下書きが削除された意味ではない。Safariのほうも開き、別の保存領域として扱う。
3. ブラウザ間で患者データをURL・QRコード・Cookie・外部ストレージ・AIへ転送しない。**自動的な移行機能は今回追加しない**。移行が必要なら改めて安全設計・人間承認を要する。
4. 試験は架空データのみ。Safariとホーム画面の双方で、下書き保存・再起動・発行PDF・手書き・クラスプ・添付を動作確認する。
5. 一時的な`trycloudflare.com`試験用アドレスをホーム画面の本番アプリとして登録しない。**承認・マージ後の恒久GitHub Pages URLだけ**をホーム画面に追加する。

## キャッシュ／オフライン対応

今回は**Service Workerを登録せず、Cache Storageへの自動保存・事前配信・バックグラウンド転送を追加しない**。患者の入力データ・発行PDF・写真・動画・音声等を新たにブラウザのキャッシュへ保存しない。

ホーム画面Webアプリ化はUIの起動方式であり、**オフライン利用や、医院から技工所PCへの確実な転送を保証する機能ではない**。既存の転送設計とは分離する。

## 受入確認（実機）

1. **本番マージ前**：PCのheadless検証で`manifest.webmanifest`が読み込まれ、アイコンが取得でき、GitHub Pagesサブパスにリンクが解決されることを確認する。
2. iPad Safariで試験URLを開き、承認済みの横向き青緑デザイン／既存機能を架空データで確認する。
3. マージ承認後に**恒久本番URL**をSafariからホーム画面に追加し、利用OSで「Webアプリとして開く」が有効か確認する。
4. ホーム画面アイコンから開き、アドレスバーが非表示になったか、横向きレイアウトのはみ出しがないか確認する。
5. Safariとは別の保存領域に、架空の番号・下書き・手書き・資料が保存／再表示されることを確認する。PDFを生成・表示できることを確認する。
6. 実機未確認を`PASS`としない。ユーザーの**明示マージ承認**なしに本番`main`へ反映しない。

参考：WebKit `https://webkit.org/blog/14787/webkit-features-in-safari-17-2/`、Apple iPad User Guide `https://support.apple.com/en-gb/guide/ipad/ipad8f1f7a29/27/ipados/27`。
