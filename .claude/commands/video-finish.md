---
description: 動画編集の Step 2。テロップ修正後、本編動画を最後まで仕上げる
argument-hint: <input video path>
---

入力動画: `$ARGUMENTS`

これは2段階ワークフローの **Step 2（最終仕上げ）** です。`/video-start` で生成された `transcript_edit.md` がユーザーによって編集されている前提で、ジェットカットから本編動画レンダリングまで一気に完走させてください。

## 実行手順

1. **前提条件チェック**
   - `work/<name>/transcript.json` が存在することを確認（なければ `/video-start` を先に実行するよう案内）
   - `work/<name>/transcript_edit.md` が存在することを確認

2. **編集状況の軽い確認**
   - `transcript_edit.md` を Read で開いて、いくつかのセグメントが編集されているかを軽く確認
   - 編集が一切されていないようなら「編集なしで進めますか？」と1度だけ確認する。それ以外はそのまま進める

3. **メイン動画パイプラインを実行**
   - `npm run main -- "$ARGUMENTS"` を実行
   - 内部で以下が走る:
     - preprocess（キャッシュ済みなのでスキップされる、編集ファイルが反映される）
     - jetcut（キャッシュなければ実行）
     - broll plan（キャッシュなければ Gemini で計画）
     - 画像生成（Gemini）
     - Renoise依頼ファイル生成（必要があれば）

4. **Renoise動画が必要な場合**
   - `work/<name>/renoise_requests.json` が生成されたら:
     - 各エントリの `prompt` と `outputPath` を読み取る
     - `node ~/.claude/plugins/marketplaces/renoise-plugins-official/skills/renoise-gen/renoise-cli.mjs credit me` で残高確認
     - 各エントリについて `task create` でRenoiseタスクを並列起動
     - `task wait` で完了を待つ
     - 完了したらビデオをダウンロードして指定の `outputPath` に保存
     - `work/<name>/broll_plan.json` の該当エントリの `needsRenoise` を `false` に書き換える
   - 全部揃ったらもう一度 `npm run main -- "$ARGUMENTS"` を実行してBロール組み込み版をレンダリング

5. **完成報告**
   - 出力ファイルパスをユーザーに提示する: `output/main/<name>_main.mp4`
   - サイズと長さも軽く触れる
   - **ショート動画は今回は生成しないことを明示**
   - ショートも欲しい場合は `/edit-short "$ARGUMENTS" 2` を案内する

## 注意点

- ショート動画（`npm run short`）は実行しない
- ユーザーが明示的に再修正を求めた場合は `/video-start` に戻ることを案内する
- エラーが出たら状況を報告し、勝手に破壊的操作（キャッシュ削除など）をしない
