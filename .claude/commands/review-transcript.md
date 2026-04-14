---
description: 入力動画の文字起こしを手動修正するための編集ファイルを開く
argument-hint: <input video path>
---

入力動画: `$ARGUMENTS`

以下の手順で文字起こしレビューを支援してください:

1. `input/` に入力ファイルが存在することを確認する
2. `work/<name>/transcript_edit.md` が存在しない場合:
   - `npm run preprocess -- "$ARGUMENTS"` を実行して文字起こしと編集ファイルを生成する
3. `work/<name>/transcript_edit.md` のフルパスをユーザーに伝える
4. ファイルを Read で開いて先頭30行ほど表示し、ユーザーに「ここを修正してください」と促す
5. ユーザーが修正完了を伝えたら、`/edit-main "$ARGUMENTS"` を実行するか `npm run main -- "$ARGUMENTS"` を案内する

注意:
- 角括弧 `[#番号 開始-終了]` は絶対に変更してはいけないことを明示する
- 行の追加/削除/並び替えもしてはいけない
- 編集はテキスト部分（角括弧の右側）のみ
