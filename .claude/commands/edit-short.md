---
description: 画面収録から9:16縦型ショート動画（1〜数本）を生成する
argument-hint: <input video path> [count]
---

入力: `$ARGUMENTS`

引数は「動画パス」または「動画パス 本数」の形式です。本数が省略された場合は2本生成します。

以下の手順でショート動画を生成してください:

1. `input/` に入力ファイルが存在することを確認する
2. `npm install` が未実行なら先に走らせる
3. `.env` に `OPENAI_API_KEY` と `GEMINI_API_KEY` が設定されていることを確認する
4. `npm run short -- $ARGUMENTS` を実行する
   - Stage 1 (preprocess) と Stage 2 (jetcut) は自動でキャッシュを再利用する
   - Gemini がハイライトを選び、各ハイライトを 9:16 にクロップして Remotion でレンダリングする
5. 完成した `output/shorts/<name>_short*.mp4` のパスを一覧でユーザーに提示する
6. Gemini が選んだハイライトのタイトルと理由も `work/<name>/highlights.json` から抽出してまとめる

ユーザーがハイライト選定をやり直したい場合は `work/<name>/highlights.json` を削除してから再実行することを案内する。
