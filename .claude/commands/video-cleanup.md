---
description: 指定動画の work/<name>/ キャッシュを削除（output/ は保護される）
argument-hint: <input video or basename>
---

対象: `$ARGUMENTS`

以下を実行してください:

1. `npm run cleanup -- "$ARGUMENTS"` を実行する
2. 削除された容量をユーザーに報告する
3. `output/main/`, `output/shorts/`, `output/edit/` の該当ファイルは **削除されない** ことを明示する
4. 再度この動画を処理する場合は Whisper や Bロール生成が再実行されるため、API コストが再度発生する旨を案内する

絶対にやらないこと:
- `output/` 配下の削除
- 他の動画の `work/` の削除
- ユーザーが明示しない限り確認なしで削除
