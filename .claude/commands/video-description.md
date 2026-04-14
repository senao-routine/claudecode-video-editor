---
description: YouTube概要欄（タイトル案3つ+概要文+章立て+ハッシュタグ+タグ）を生成する
argument-hint: <input video path>
---

入力動画: `$ARGUMENTS`

以下を実行してください:

1. **前提条件チェック**
   - `work/<name>/transcript.json` が存在することを確認
   - 存在しない場合は `/video-start` を先に実行するよう案内して停止
   - `work/<name>/cut_plan.json` も必要（jetcut 済みかどうか）。なければ `/video-finish` または `/video-export-edit` を先に実行するよう案内
   - `transcript_edit.md` の手動修正が反映されることを伝える

2. **概要欄生成**
   - `npm run youtube -- "$ARGUMENTS"` を実行
   - 内部で Gemini が文字起こし（編集済み）を読んで JSON を返す
   - 出力は `output/edit/<name>/youtube.md`

3. **結果を整理して提示**
   - タイトル案 3つを番号付きリストで
   - 概要文を引用ブロックで
   - 章立て（タイムスタンプ付き）をコードブロックで
   - ハッシュタグ + タグリスト
   - ファイルパス `output/edit/<name>/youtube.md` を伝える

4. **ユーザーへの補足**
   - タイムスタンプは jetcut 後の動画（4分前後）に合わせているので、そのまま YouTube の概要欄に貼り付けると章機能が動作することを明示
   - タイトル案3つから好きなものを選んで使う
   - ファイル末尾に「コピペ用」ブロックがあり、概要欄にそのまま貼り付けできる形式で入っていることを案内

絶対にやらないこと:
- 文字起こしにない情報を追加する
- 誇張したタイトルや釣りタイトルを作る
- 既存の `output/edit/<name>/` の他ファイルを上書きしない（youtube.md だけ新規/更新）
