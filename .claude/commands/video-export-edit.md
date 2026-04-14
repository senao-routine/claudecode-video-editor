---
description: Premiere Pro / Filmora 等で編集するための素材セット（カット動画+SRT+FCP XML+マーカー）を出力する
argument-hint: <input video path>
---

入力動画: `$ARGUMENTS`

これは焼き込み版（`/video-finish`）とは独立した、**編集ソフト用の素材エクスポート** コマンドです。動画にテロップやBロールを焼き込まず、Premiere Pro / Filmora / DaVinci Resolve / Final Cut Pro で編集するための中間ファイル群を出力します。

## 実行手順

1. **入力ファイル確認**
   - `input/` 配下に `$ARGUMENTS` が存在することを確認

2. **前提条件チェック**
   - `work/<name>/transcript.json` がなければ `/video-start` で文字起こしすることを案内
   - すでに `transcript_edit.md` で手動修正されている場合はそれが反映される旨を伝える

3. **エクスポート実行**
   - `npm run export-edit -- "$ARGUMENTS"` を実行
   - 内部で preprocess / jetcut / broll plan のキャッシュを再利用
   - Renoise B-roll動画は **生成しない**（プランとして markers にだけ含まれる）

4. **出力内容を提示**
   - `output/edit/<name>/` のフルパスをユーザーに伝える
   - 含まれるファイル一覧を表で表示:
     - `jetcut.mp4` — 本編動画
     - `subtitles.srt` — 字幕（SRT、Premiere/Filmora共通）
     - `subtitles.ass` — 字幕（ASS、スタイル付き）
     - `timeline.xml` — FCP XML（Premiere/DaVinci/FCP）
     - `timeline.edl` — EDL（Filmora用）
     - `markers.csv` — Bロール+ハイライトのマーカー表
     - `markers.json` — 同上 JSON
     - `broll/` — 生成済みBロール画像
     - `README.md` — 使い方
   - Premiere と Filmora での読み込み手順を簡潔に伝える

5. **既存の焼き込み版との関係を明示**
   - `/video-finish` の自動生成版は `output/main/` に残ったまま
   - このコマンドは `output/edit/` に別途エクスポートする
   - 両方を使い分けて OK

## 注意点

- このコマンドは Renoise の追加課金は発生させない
- `transcript_edit.md` の編集内容は字幕に反映される
- 既存の `/video-start` `/video-finish` フローには影響しない
