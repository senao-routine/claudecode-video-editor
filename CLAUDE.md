# Claudecode 動画編集 — プロジェクトガイド

このプロジェクトは画面収録動画から **本編動画** と **9:16 ショート動画** を自動生成するパイプラインです。

## スタイル設定の正典: `config/style.json`

> **重要なルール**: 字幕フォント・色・サイズ、Bロールの表示方法、画像/動画生成のスタイル指示を変更したいときは **必ず [`config/style.json`](config/style.json) を編集** してください。
>
> このファイルがプロジェクトの「見た目とAI生成挙動」の唯一の正典です。コンポーネントやスクリプトを直接書き換えないでください。詳細は [`config/README.md`](config/README.md) を参照。

新しい設定項目を追加するときも:
1. まず `config/style.json` にキーを追加
2. `scripts/lib/style.ts` の型と Zod スキーマに反映
3. その値を読む側（Remotion コンポーネント / スクリプト）から参照

の順で進めてください。

## パイプラインの流れ

```
input/<name>.mp4
   │
   ▼  preprocess (FFmpeg + Whisper)
work/<name>/{audio_normalized.wav, silences.json, transcript.json}
   │
   ▼  jetcut (FFmpeg)
work/<name>/jetcut.mp4
   │
   ├─▶ broll (Gemini + Renoise)
   │      work/<name>/broll_plan.json
   │      work/<name>/broll/{broll_*.png|mp4}
   │
   ├─▶ main (Remotion)
   │      output/main/<name>_main.mp4
   │
   └─▶ short (Gemini highlights + FFmpeg crop + Remotion)
          output/shorts/<name>_short*.mp4
```

## 主要ファイル

- [`config/style.json`](config/style.json) — スタイル・生成挙動の設定（編集対象）
- [`scripts/lib/style.ts`](scripts/lib/style.ts) — 設定の型定義とローダー
- [`scripts/01-preprocess.ts`](scripts/01-preprocess.ts) — 音声抽出 + Whisper
- [`scripts/02-jetcut.ts`](scripts/02-jetcut.ts) — 無音除去カット
- [`scripts/03-broll.ts`](scripts/03-broll.ts) — Bロール計画+生成
- [`scripts/04-main-video.ts`](scripts/04-main-video.ts) — 本編動画オーケストレーター
- [`scripts/05-short-video.ts`](scripts/05-short-video.ts) — ショート動画エクストラクター
- [`remotion/src/compositions/`](remotion/src/compositions/) — Remotion コンポジション

## 標準ワークフロー（2段階）

普段の動画編集はこの2段階で行う:

```
[Step 1] /video-start input/xxx.mp4
   → 文字起こし & テロップ確認用ファイル生成
   → 停止してユーザー確認待ち

[Step 1.5] ユーザーが work/<name>/transcript_edit.md を修正
   → カタカナ・固有名詞・英語表記を直す

[Step 2] /video-finish input/xxx.mp4
   → ジェットカット → Bロール → Remotion レンダリング
   → 本編動画完成

[Step 2.5（任意）] /edit-short input/xxx.mp4 2
   → ショート動画も欲しい場合
```

### スラッシュコマンド一覧

**制作系:**

| コマンド | 役割 |
|---|---|
| `/video-start <input>` | 文字起こしまで実行して停止。標準的な開始点 |
| `/video-finish <input>` | 本編動画（焼き込み版）を最後まで仕上げる |
| `/video-export-edit <input>` | Premiere Pro / Filmora 用の編集素材セットを出力（焼き込みなし） |
| `/video-description <input>` | YouTube 概要欄を生成（タイトル案+概要文+章立て+タグ） |
| `/edit-short <input> [count]` | ショート動画を生成 |
| `/edit-main <input>` | （非推奨）テロップ確認なしで本編を全自動生成。素早く試したいとき用 |
| `/review-transcript <input>` | 既存の編集ファイルを再表示する |

**管理系:**

| コマンド | 役割 |
|---|---|
| `/video-list` | 全動画の状態を一覧表示（work/output の使用状況） |
| `/video-cleanup <name>` | 指定動画の `work/` キャッシュを削除（`output/` は保護） |
| `/video-archive <name>` | `output/edit/<name>/` を zip 化して持ち出しやすくする |

### 2つの出力モード

このパイプラインには **焼き込み版** と **編集ソフト用エクスポート** の2モードがあり、用途で使い分けます。

| モード | 用途 | コマンド | 出力先 |
|---|---|---|---|
| 焼き込み版 | そのまま投稿できる完成動画が欲しい | `/video-finish` | `output/main/<name>_main.mp4` |
| 編集ソフト用 | Premiere Pro / Filmora で最終調整したい | `/video-export-edit` | `output/edit/<name>/` 一式 |

両モードは preprocess / jetcut / broll plan のキャッシュを共有するので、同じ素材に対して両方実行しても無駄な再処理は起きません。

### 直接実行（CLI）

```bash
npm run preprocess -- input/xxx.mp4   # Step 1 だけ
npm run main -- input/xxx.mp4         # 本編動画（preprocess含む）
npm run short -- input/xxx.mp4 2      # ショート動画
```

## 文字起こしの手動修正フロー

Whisper はカタカナ語・固有名詞・英語の専門用語をしばしば誤認識します。これを直すための **編集用ファイル** が自動で生成されます。

```
work/<name>/transcript_edit.md
```

### 流れ

1. 入力動画を `input/` に置く
2. `npm run preprocess -- input/xxx.mp4` を実行（または `/edit-main` の冒頭で自動実行される）
3. `work/<name>/transcript_edit.md` が生成される
4. **このファイルを開いて誤認識を手動で修正** する
   - 角括弧 `[#番号 開始-終了]` は絶対に変更しない
   - 行を増やしたり減らしたりしない
   - 角括弧の右側のテキストだけを編集する
5. `npm run main -- input/xxx.mp4` を実行
6. 編集内容が自動で反映されて本編動画がレンダリングされる

### 編集ファイル例

```
[#  0    0.00-  2.50] こんにちは、せなおです
[#  1    2.50-  5.10] 今日は AIニュース をお届けします
```

### キャッシュとの関係

- 編集内容は `transcript_edit.md` に永続化される（`transcript.json` は raw のまま）
- 何度再レンダリングしても編集内容は保たれる
- 動画ファイル自体を差し替えると `transcript_edit.md` は新しい内容で再生成される

## キャッシュの仕組み

- preprocess / jetcut / broll plan は `work/<name>/` にキャッシュされる
- 同じ入力動画に対して再実行するとキャッシュをスキップして即座に Remotion レンダリングだけ行う
- スタイルだけ変更したい場合は `work/<name>/` を残したまま `npm run main` を再実行すれば、Whisper / Renoise の追加コストはかからない
- B-roll の方針自体を変えたい場合は `work/<name>/broll_plan.json` と `work/<name>/broll/` を削除して再実行する

## やってはいけないこと

- 字幕フォントやBロール表示方法を変えるために Remotion コンポーネントを直接書き換える（`config/style.json` を経由）
- 入力動画ファイルの変更（読み取り専用扱い）
- `output/` 配下を手動編集（自動生成物）
