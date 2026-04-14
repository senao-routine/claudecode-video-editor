---
description: 画面収録から本編動画（ジェットカット+字幕+Bロール付き）を生成する
argument-hint: <input video path (relative to project root)>
---

入力動画: `$ARGUMENTS`

以下の手順で本編動画を生成してください:

1. `input/` に入力ファイルが存在することを確認する
2. `npm install` が未実行なら先に走らせる
3. `.env` に `OPENAI_API_KEY` と `GEMINI_API_KEY` が設定されていることを確認する（未設定ならユーザーに伝えて停止）
4. `npm run main -- "$ARGUMENTS"` を実行する
5. `work/<name>/renoise_requests.json` が生成されていたら:
   - それを読み込み、各エントリについて `video-maker:renoise-gen` スキルで動画を生成する
   - 生成した動画を各エントリの `outputPath` に配置する
   - `work/<name>/broll_plan.json` の該当エントリで `needsRenoise` を `false` に書き換える
   - 再度 `npm run main -- "$ARGUMENTS"` を実行して Remotion レンダリングをやり直す
6. 完成した `output/main/<name>_main.mp4` のパスをユーザーに提示する

エラー時は状況を説明し、ユーザーの判断を仰ぐ。勝手に破壊的操作（ファイル削除・キャッシュクリアなど）を行わない。
