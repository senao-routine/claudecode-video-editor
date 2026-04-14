---
description: output/edit/<name>/ を zip 化して別PCに持ち出しやすくする
argument-hint: <input video or basename>
---

対象: `$ARGUMENTS`

以下を実行してください:

1. `output/edit/<basename>/` が存在するか確認
   - 存在しない場合は「`/video-export-edit` を先に実行してください」と案内して停止
2. `npm run archive -- "$ARGUMENTS"` を実行
3. 生成された zip のパスとサイズをユーザーに伝える
4. 圧縮ファイルは `output/edit/<basename>.zip` に出力される
5. このzipには jetcut.mp4 + subtitles.srt + timeline.xml + markers + broll + README などが全て含まれていることを補足する

絶対にやらないこと:
- 元の `output/edit/<basename>/` フォルダは削除しない
- zip 作成中に work/ のキャッシュを触らない
