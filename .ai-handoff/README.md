# .ai-handoff/

このディレクトリは、同一PC上で動作するローカルAI CLI間（V1では Claude Code ↔ Codex CLI）が、人間のコピー&ペーストを介さずに状態・監査結果・次指示を受け渡すための仕組みです。詳細は`ai-dev-foundation`の`local-ai-handoff`スキルを参照してください。

## 構成

```
.ai-handoff/
├─ README.md（このファイル）
└─ runtime/
   ├─ outbox/      # 送信済み・まだ配達されていないメッセージ
   ├─ inbox/        # 配達済み・宛先AIが未読のメッセージ
   └─ processed/    # 読了・対応済みのメッセージ（削除せず監査証跡として保持）
```

## 対象AI（V1）

- **Claude ↔ Codex**：対象。両方ともこのPC上でローカルファイルを読み書きできる。
- **Gemini / Antigravity**：V1では未接続。将来の拡張ポイントとしてプロトコルは対応可能だが、既定のフローには組み込まれていない。
- **ブラウザ版GPT**：対象外。ローカルファイルを読めないため、既存のGitHub `[AI_HANDOFF]` PRコメント経路を引き続き使用する。ここに新しいGPT専用形式を作らない。

## このrepositoryでの扱い

- `.ai-handoff/runtime/`は**git追跡しません**。`.gitignore`で除外しています（`AGENTS.local.md`「Local AI Handoff」節参照）。
- この`README.md`自体は追跡対象です。

## 安全上の注意

- secrets・token・個人情報・実データをここに書かない（`ai-dev-foundation`の`CORE.md`参照）。
- ここでのやり取りは、`OPERATIONS.md`のHuman Confirmation Points（仕様判断・実機判断・高リスク操作・想定外差分・NG/UNKNOWN・LOOP DETECTED・承認範囲の変化・merge直前）を迂回する経路にしない。
- digital-work-order固有の保護対象（`localStorage`永続化、手書き保存構造、PDF処理、クラスプ、歯式・歯番、祝日判定、割増判定）に関わる指示をhandoff経由で渡す場合も、`AGENTS.local.md`の既存ルールを省略しない。
