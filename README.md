# Claudecode 動画編集

Claude Code から呼び出す **AI 駆動の動画編集パイプライン** です。1本の画面収録動画を入力に、ジェットカット → 字幕 → Bロール挿入 → ショート動画 → YouTube 概要欄 まで一気通貫で生成します。

---

## 目次

- [何ができるか](#何ができるか)
- [使用している AI モデル](#使用している-ai-モデル)
- [プロジェクト構成](#プロジェクト構成)
- [セットアップ](#セットアップ)
- [標準ワークフロー](#標準ワークフロー)
- [スラッシュコマンド一覧（詳細）](#スラッシュコマンド一覧詳細)
- [config/style.json で調整できること](#configstylejson-で調整できること)
- [出力ファイル一覧](#出力ファイル一覧)
- [トラブルシューティング](#トラブルシューティング)
- [コストの目安](#コストの目安)

---

## 何ができるか

```
input/動画.mp4
   │
   ▼  preprocess (FFmpeg + Whisper)
work/動画/audio_normalized.wav, silences.json, transcript.json, transcript_edit.md
   │
   ├─▶  ⏸  ユーザーが transcript_edit.md を手動修正
   │
   ▼  jetcut (FFmpeg)              ←  無音除去で動画を詰める
work/動画/jetcut.mp4
   │
   ├─▶  broll (Gemini + Renoise)
   │       Gemini が文脈から「ここで Bロール」を判定
   │       画像 = NanoBanana 2 で生成
   │       動画 = Seedance 2.0 で生成
   │
   ├─▶ [本編動画] Remotion で字幕+Bロール焼き込み
   │       output/main/動画_main.mp4
   │
   ├─▶ [ショート動画] Gemini ハイライト検出 → 9:16 縦型
   │       output/shorts/動画_short1_*.mp4
   │
   ├─▶ [編集ソフト用素材] Premiere/Filmora/DaVinci/FCP 用
   │       output/edit/動画/jetcut.mp4 + SRT + ASS + FCP XML + EDL + マーカー
   │
   └─▶ [YouTube 概要欄] タイトル案+概要文+章立て+ハッシュタグ
           output/edit/動画/youtube.md
```

主な特徴:

- **2段階ワークフロー** (`/video-start` → ユーザー確認 → `/video-finish`) で文字起こしを手動修正してから動画化できる
- **チャンク方式の字幕** で常に同じフォントサイズ、文節単位で滑らかに切り替わる
- **動画品質の Vision OCR 検証** で英語混入や壊れた日本語を自動検知
- **2 つの出力モード**: 焼き込み版（投稿用） と 編集ソフト用（後加工用）が共存
- **キャッシュベース** で再実行は高速、API コストは最小化

---

## 使用している AI モデル

| 用途 | モデル | API 経路 | 課金 |
|---|---|---|---|
| **文字起こし** | Whisper (`whisper-1`) | OpenAI API | OpenAI 従量課金 (~$0.006/分) |
| **Bロール計画** | Gemini 2.5 Pro | Google AI Studio | 無料枠あり |
| **ハイライト検出** | Gemini 2.5 Pro | Google AI Studio | 無料枠あり |
| **画像生成 (Bロール)** | NanoBanana 2 (`gemini-3.1-flash-image-preview`) | Google AI Studio | $0.045〜0.151/枚 |
| **画像品質検証** | Gemini 2.5 Flash | Google AI Studio | 無料枠あり |
| **YouTube 概要欄生成** | Gemini 2.5 Pro | Google AI Studio | 無料枠あり |
| **動画生成 (Bロール)** | Seedance 2.0 (`renoise-2.0`) | Renoise CLI | Renoise クレジット (約 100〜300/本) |
| **本編レンダリング** | Remotion (React) | ローカル処理 | 無料 |
| **動画編集処理** | FFmpeg | ローカル処理 | 無料 |

---

## プロジェクト構成

```
Claudecode 動画編集/
├── README.md                    ← このファイル
├── CLAUDE.md                    ← Claude Code 用プロジェクトガイド
├── package.json                 ← npm scripts
├── tsconfig.json
├── .env                         ← APIキー（Git管理外）
├── .env.example
│
├── config/
│   ├── style.json               ← フォント・字幕・生成スタイル設定（編集対象）
│   └── README.md                ← style.json の説明
│
├── input/                       ← ★ 元動画を置く場所
│
├── work/                        ← 中間ファイル（キャッシュ）
│   └── <動画名>/
│       ├── audio.wav
│       ├── audio_normalized.wav
│       ├── silences.json
│       ├── transcript.json
│       ├── transcript_edit.md   ← ★ ユーザー編集対象
│       ├── jetcut.mp4
│       ├── cut_plan.json
│       ├── broll_plan.json
│       ├── broll/               ← 生成済み画像/動画
│       └── highlights.json
│
├── output/                      ← 最終成果物
│   ├── main/                    ← 焼き込み版本編動画
│   │   └── <動画名>_main.mp4
│   ├── shorts/                  ← ショート動画
│   │   └── <動画名>_shortN_<タイトル>.mp4
│   └── edit/                    ← 編集ソフト用素材
│       └── <動画名>/
│           ├── jetcut.mp4
│           ├── subtitles.srt
│           ├── subtitles.ass
│           ├── timeline.xml
│           ├── timeline.edl
│           ├── markers.csv
│           ├── markers.json
│           ├── broll/
│           ├── youtube.md
│           └── README.md
│
├── scripts/
│   ├── 01-preprocess.ts         ← Whisper + 無音検出
│   ├── 02-jetcut.ts             ← 無音除去
│   ├── 03-broll.ts              ← Bロール計画+生成
│   ├── 04-main-video.ts         ← 本編動画オーケストレーター
│   ├── 05-short-video.ts        ← ショート動画
│   ├── 06-export-edit.ts        ← 編集ソフト用素材エクスポート
│   ├── 07-youtube-description.ts← YouTube 概要欄生成
│   ├── utils-cleanup.ts         ← work/ クリーンアップ
│   ├── utils-list.ts            ← 一覧表示
│   ├── utils-archive.ts         ← zip化
│   └── lib/
│       ├── config.ts            ← env 読み込み
│       ├── paths.ts             ← パス管理
│       ├── shell.ts             ← サブプロセス実行
│       ├── ffmpeg.ts            ← FFmpeg ラッパー
│       ├── whisper.ts           ← Whisper API
│       ├── gemini.ts            ← Gemini API ラッパー
│       ├── renoise.ts           ← Renoise CLI ラッパー（動画）
│       ├── renoise-image.ts     ← Renoise CLI ラッパー（画像）
│       ├── vision-verify.ts     ← OCR 検証
│       ├── style.ts             ← style.json ローダー
│       ├── subtitle-chunks.ts   ← 字幕チャンク分割
│       ├── subtitle-wrap.ts     ← 字幕改行（旧）
│       ├── transcript-edit.ts   ← 文字起こし手動修正
│       ├── timeline.ts          ← jetcut タイムライン変換
│       └── edit-exporters.ts    ← SRT/ASS/FCPXML/EDL 書き出し
│
├── remotion/                    ← Remotion (React) プロジェクト
│   ├── remotion.config.ts
│   └── src/
│       ├── index.ts
│       ├── Root.tsx             ← Composition 登録
│       ├── types.ts             ← Zod スキーマ
│       ├── compositions/
│       │   ├── MainVideo.tsx    ← 16:9 本編
│       │   └── ShortVideo.tsx   ← 9:16 ショート
│       └── components/
│           ├── Subtitles.tsx    ← 字幕レンダラー
│           └── BRollLayer.tsx   ← Bロール PiP / Fullscreen
│
└── .claude/commands/            ← スラッシュコマンド定義
    ├── video-start.md
    ├── video-finish.md
    ├── video-export-edit.md
    ├── video-description.md
    ├── edit-short.md
    ├── edit-main.md
    ├── review-transcript.md
    ├── video-list.md
    ├── video-cleanup.md
    └── video-archive.md
```

---

## セットアップ

### 1. 必要な環境

| ソフト | 確認方法 | 役割 |
|---|---|---|
| **Node.js 18+** | `node -v` | TypeScript 実行環境 |
| **FFmpeg** | `ffmpeg -version` | 動画/音声処理 |
| **Renoise プラグイン** | `~/.claude/plugins/marketplaces/renoise-plugins-official/` | Bロール動画生成 |

macOS なら Homebrew でインストール:

```bash
brew install node ffmpeg
```

### 2. APIキーの取得と設定

`.env` ファイルに以下を記入:

```bash
# OpenAI (Whisper 文字起こし用)
OPENAI_API_KEY=sk-...

# Google AI Studio (Gemini API)
# https://aistudio.google.com/apikey で取得
GEMINI_API_KEY=AIza...

# Renoise (Bロール動画生成)
# https://www.renoise.ai で取得
RENOISE_API_KEY=fk_...
```

### 3. 依存パッケージのインストール

```bash
npm install
```

### 4. 動作確認

```bash
npm run list
```

エラーなく実行できればセットアップ完了です。

---

## 標準ワークフロー

### 通常パターン: 文字起こし確認 → 本編動画

```
1. 動画を input/ に置く
   例: input/20260410_AI解説.mp4

2. /video-start input/20260410_AI解説.mp4
   ↓ Whisper で文字起こし
   ↓ 誤認識候補をハイライト表示
   ⏸ 停止

3. work/20260410_AI解説/transcript_edit.md を開いて修正
   - カタカナ語、固有名詞、英単語のスペル等を手直し
   - 角括弧 [#番号 開始-終了] は絶対に変更しない
   - 行の追加/削除/並び替えは禁止

4. /video-finish input/20260410_AI解説.mp4
   ↓ ジェットカット
   ↓ Gemini が Bロール計画
   ↓ NanoBanana 2 で画像生成 + Vision検証
   ↓ Seedance 2.0 で動画生成（必要に応じて）
   ↓ Remotion で字幕+Bロール焼き込み
   完了 → output/main/20260410_AI解説_main.mp4

5. /edit-short input/20260410_AI解説.mp4 2
   ↓ Gemini がハイライト検出
   ↓ 9:16 縦型ショート 2本生成
   完了 → output/shorts/20260410_AI解説_short1_*.mp4

6. /video-description input/20260410_AI解説.mp4
   ↓ YouTube 概要欄生成
   完了 → output/edit/20260410_AI解説/youtube.md
```

### Premiere Pro / Filmora で編集したい場合

```
1〜3. 同上（input → /video-start → 修正）

4. /video-export-edit input/20260410_AI解説.mp4
   ↓ ジェットカット動画 + SRT + FCP XML + マーカー一式を出力
   完了 → output/edit/20260410_AI解説/

5. (任意) /video-archive 20260410_AI解説
   ↓ zip 化して別 PC に持ち出し
   完了 → output/edit/20260410_AI解説.zip
```

---

## スラッシュコマンド一覧（詳細）

### 制作系コマンド

#### `/video-start <input>` — 文字起こしまで実行して停止

**何をするか:**
1. 入力動画から音声を抽出（mono 16kHz WAV）
2. EBU R128 ラウドネス正規化
3. FFmpeg `silencedetect` で無音区間を検出
4. Whisper API で文字起こし（チャンク分割で長尺対応）
5. 人間が編集しやすい `transcript_edit.md` を生成
6. Whisper が間違えやすい箇所（カタカナ語、固有名詞、英語）をハイライト
7. **完全停止** してユーザーの確認を待つ

**生成されるファイル:**
- `work/<name>/audio.wav`
- `work/<name>/audio_normalized.wav`
- `work/<name>/silences.json`
- `work/<name>/transcript.json` (Whisper 生データ)
- `work/<name>/transcript_edit.md` (★ 編集対象)

**所要時間:** 5分動画で約 1〜2 分（Whisper 呼び出し含む）

**コスト:** Whisper のみ。5分動画で約 $0.03（4.5円）

---

#### `/video-finish <input>` — 焼き込み版本編動画を生成

**何をするか:**
1. preprocess / jetcut / broll plan のキャッシュを再利用
2. `transcript_edit.md` の手動修正を反映
3. ジェットカットで無音除去（FFmpeg `trim+concat` フィルター）
4. Gemini が文脈から Bロール挿入位置を計画
5. NanoBanana 2 で静止画 Bロール生成（最大3回試行 + Vision 検証）
6. Renoise (Seedance 2.0) で動画 Bロール生成
7. Remotion (React) で字幕+Bロール+本編を1本に焼き込み
8. ヒラギノ角ゴ W9 で字幕、文節10〜15文字単位のチャンク方式

**生成されるファイル:**
- `work/<name>/jetcut.mp4` (中間)
- `work/<name>/cut_plan.json` (中間)
- `work/<name>/broll_plan.json` (中間)
- `work/<name>/broll/broll_*.png|.mp4` (中間)
- `output/main/<name>_main.mp4` ★ 完成品

**所要時間:** 5分動画で約 10〜20 分（Renoise 動画生成が一番時間かかる）

**コスト:** Gemini (無料枠内) + Renoise (Bロール動画 1本あたり 100〜300 クレジット)

---

#### `/video-export-edit <input>` — Premiere/Filmora 用素材一式を出力

**何をするか:**

`/video-finish` と同じ処理を行うが、**焼き込みはせず** に編集ソフト用の中間ファイルだけ書き出す。

1. preprocess / jetcut / broll plan のキャッシュを再利用
2. `jetcut.mp4` を `output/edit/<name>/` にコピー
3. チャンク字幕を SRT と ASS で書き出し
4. FCP XML (Premiere/DaVinci/FCP用) を生成
5. EDL (Filmora用) を生成
6. Bロール挿入位置 + ハイライト位置を `markers.csv` / `markers.json` で出力
7. Bロール画像/動画も `output/edit/<name>/broll/` にコピー
8. 各ファイルの使い方を書いた `README.md` を同梱

**生成されるファイル一覧:**

| ファイル | 用途 |
|---|---|
| `jetcut.mp4` | 無音除去済み本編動画 |
| `subtitles.srt` | 字幕（SRT、Premiere/Filmora 共通） |
| `subtitles.ass` | 字幕（ASS、スタイル付き） |
| `timeline.xml` | FCP XML（Premiere/DaVinci/FCP） |
| `timeline.edl` | EDL（Filmora 用） |
| `markers.csv` | Bロール+ハイライト位置の表 |
| `markers.json` | 同上 JSON 版 |
| `broll/` | 生成済み Bロール画像/動画 |
| `README.md` | 使い方ガイド |

**Premiere Pro での使い方:**
1. 新規プロジェクトを作成
2. `ファイル → 読み込み` で `jetcut.mp4` を読み込む
3. `ファイル → 読み込み` で `subtitles.srt` を字幕トラックとして追加
4. `ファイル → 読み込み → XML` で `timeline.xml` を読み込み（マーカーが反映される）
5. `markers.csv` を見ながら BGM・効果音・Bロールを配置

**Filmora での使い方:**
1. `jetcut.mp4` と `subtitles.srt` をメディアパネルに追加
2. SRT を字幕トラックにドラッグ
3. `markers.csv` を別途参照しながら BGM・Bロールを配置

---

#### `/video-description <input>` — YouTube 概要欄を生成

**何をするか:**
1. 修正済み `transcript_edit.md` を読み込み
2. ジェットカット後のタイムラインに合わせる
3. Gemini に以下を生成させる:
   - **タイトル案 3つ**（角度を変えて: 具体型 / ベネフィット型 / 疑問型）
   - **概要文** 2〜3段落
   - **章立て**（YouTube仕様: 0:00 から始まる）
   - **ハッシュタグ** 3〜6個
   - **タグ**（YouTube Studio用）10〜15個
4. コピペ可能なフォーマットでまとめる

**生成されるファイル:**
- `output/edit/<name>/youtube.md`

**末尾の「コピペ用」ブロックをそのまま YouTube 概要欄にペースト** すれば、章機能も動作します。

---

#### `/edit-short <input> [count]` — ショート動画を生成

**何をするか:**
1. preprocess / jetcut のキャッシュを再利用
2. `transcript_edit.md` の修正を反映
3. Gemini がハイライト位置を選定（デフォルト 2 箇所）
4. 各ハイライトを 9:16 に縦型クロップ
5. Remotion でタイトルカード + 字幕付きで縦型動画を生成

**引数:**
- `count`: 生成するショートの本数（省略時は2本）

**生成されるファイル:**
- `output/shorts/<name>_short1_<タイトル>.mp4`
- `output/shorts/<name>_short2_<タイトル>.mp4`

**特徴:**
- 25〜60秒のハイライトを自動切り出し
- 縦型16:9ベース動画 + 上部にタイトル + 下部に字幕
- 字幕は本編と同じチャンク方式

---

#### `/edit-main <input>` — 全自動本編生成（テロップ確認なし）

**何をするか:**

`/video-start` → `/video-finish` を1コマンドで実行する **省略版**。テロップ確認ステップを飛ばすので、Whisper の誤認識がそのまま字幕に出る可能性あり。

**いつ使うか:** とりあえず素早く試したいときだけ。本番は `/video-start` → `/video-finish` を推奨。

---

#### `/review-transcript <input>` — 既存の編集ファイルを再表示

**何をするか:**

`work/<name>/transcript_edit.md` の内容を画面に表示するだけ。修正の進捗確認や、誤認識候補の再ハイライトに使う。

---

### 管理系コマンド

#### `/video-list` — 全動画の状態一覧

**何をするか:**

`work/`, `output/main/`, `output/shorts/`, `output/edit/` を走査して、各動画の状態を表形式で表示。

**表示内容（例）:**

```
▶ 20260404 本編動画 canva10分
  input:✓  transcript:✓  edit:✓  jetcut:✓  broll-plan:✓  broll-assets:7
  outputs: main (106.9 MB) | shorts x2 (7.8 MB) | edit bundle (64.0 MB)
  work cache: 183.1 MB

────────────────────────────────────
totals: work 183.1 MB | main 106.9 MB | shorts 7.8 MB | edit 64.0 MB
        1 video(s), 361.9 MB on disk
```

**使うタイミング:**
- ディスク使用量を確認したい
- どの動画が処理中/完了か知りたい
- 不要なキャッシュを特定したい

---

#### `/video-cleanup <name>` — 指定動画の work/ を削除

**何をするか:**

`work/<name>/` を完全に削除する。**`output/` は削除しない**（完成済み動画は保護される）。

**使うタイミング:**
- 完成済み動画の中間ファイルを掃除したい
- ディスク容量を空けたい

**注意:**
- 削除後に再度この動画を処理すると、Whisper 文字起こしや Bロール生成が **再実行されて API コストが発生** します
- `transcript_edit.md` も消えるので、修正内容を残したい場合は別の場所にコピーしておく

---

#### `/video-archive <name>` — output/edit/ を zip 化

**何をするか:**

`output/edit/<name>/` を 1 つの zip にまとめて `output/edit/<name>.zip` に出力。

**使うタイミング:**
- 別 PC で編集したい（zip を持ち出す）
- クラウドストレージにアップロードしたい
- バックアップを取りたい

**注意:**
- `output/edit/<name>/` フォルダ自体は削除されません
- zip サイズは元フォルダの約 90〜100%（jetcut.mp4 が大半なので圧縮率は低い）

---

## config/style.json で調整できること

`config/style.json` がプロジェクトの **見た目と AI 生成挙動の唯一の正典** です。これを編集すれば、コードを書き換えずにスタイルや挙動を調整できます。

### フォント

```jsonc
"fonts": {
  "japanese": "HiraginoSans-W9, ..., sans-serif",
  "english": "Inter, Helvetica Neue, ..."
}
```

`japanese` を変えれば本編動画とショート動画の字幕フォントが一括で切り替わります。

**例: 游ゴシック Bold に変更**
```jsonc
"japanese": "\"YuGothic-Bold\", \"Yu Gothic\", sans-serif"
```

### 字幕

```jsonc
"subtitles": {
  "chunking": {
    "minChars": 10,        // 1チャンクの最小文字数
    "maxChars": 15,        // 1チャンクの最大文字数
    "minDurationSec": 0.6  // 1チャンクの最低表示時間
  },
  "main": {
    "fontSizeRatio": 0.045,  // 1080p で約 86px
    "bottomRatio": 0.07,     // 画面下端からの距離
    ...
  },
  "short": {
    "fontSizeRatio": 0.058,  // 縦型用、より大きめ
    ...
  }
}
```

### Bロール表示モード

```jsonc
"broll": {
  "defaultMode": "fullscreen",  // "pip" or "fullscreen"
  "fadeInSec": 0.25,
  "fadeOutSec": 0.25,
  "pip": {
    "widthRatio": 0.35,         // PiP の幅
    "position": "top-right",
    ...
  },
  "fullscreen": {
    "objectFit": "contain",     // "contain" or "cover"
    ...
  }
}
```

各 Bロールの表示モードは Gemini が自動判定しますが、`defaultMode` で fallback を制御できます。

### 画像生成

```jsonc
"generation": {
  "imagePrimaryModel": "gemini",                     // "gemini" or "renoise"
  "imageFallbackModel": "none",                      // フォールバック
  "imageGeminiModelId": "gemini-3.1-flash-image-preview",  // NanoBanana 2
  "imageMaxAttempts": 3,                             // 試行回数
  "imageVerify": true,                               // OCR 検証 ON/OFF
  "imageStyleGuide": "Modern, clean, professional...",  // スタイル指示
  "imageNegative": "english text, romaji, ..."          // 避けたい要素
}
```

**モデル切り替え例:**
- NanoBanana Pro に変える: `"imageGeminiModelId": "gemini-3-pro-image-preview"`
- 旧 NanoBanana に戻す: `"imageGeminiModelId": "gemini-2.5-flash-image"`

### 動画生成

```jsonc
"generation": {
  "videoStyleGuide": "Short cinematic motion-graphics B-roll...",
  "videoNegative": "english text, romaji, ..."
}
```

動画モデル（Seedance 2.0）は固定です。プロンプトのスタイル指示だけ変更可能。

詳細は `config/README.md` を参照。

---

## 出力ファイル一覧

### 本編動画（焼き込み版）

```
output/main/<name>_main.mp4
```

- 16:9 1920x1080 / 30fps / H.264 / AAC 48kHz
- 字幕とBロールが完全に焼き込まれた状態
- そのまま YouTube に投稿可能

### ショート動画

```
output/shorts/<name>_short1_<タイトル>.mp4
output/shorts/<name>_short2_<タイトル>.mp4
```

- 9:16 1080x1920 / 30fps / H.264 / AAC 48kHz
- 25〜60秒
- TikTok / YouTube Shorts / Instagram Reels に投稿可能

### 編集ソフト用素材

```
output/edit/<name>/
├── jetcut.mp4          # 無音除去済み本編動画
├── subtitles.srt       # 字幕 (SRT)
├── subtitles.ass       # 字幕 (ASS, スタイル付き)
├── timeline.xml     # FCP XML (Premiere/DaVinci/FCP)
├── timeline.edl        # EDL (Filmora)
├── markers.csv         # マーカー表
├── markers.json        # マーカー JSON
├── broll/              # 生成済み Bロール画像/動画
├── youtube.md          # YouTube 概要欄
└── README.md           # 使い方ガイド
```

### YouTube 概要欄

`output/edit/<name>/youtube.md` には以下が含まれます:

```markdown
## タイトル案
1. 〜
2. 〜
3. 〜

## 概要文
（2〜3段落）

## 章立て（タイムスタンプ）
0:00 オープニング
0:49 〜
2:05 〜

## ハッシュタグ
#AI #生成AI ...

## タグ（YouTube Studio 用）
Canva, Magic Layers, ...

## コピペ用
（YouTube 概要欄にそのまま貼り付け可能なブロック）
```

---

## トラブルシューティング

### Whisper の文字起こしが英語混じりや固有名詞でおかしい

→ `transcript_edit.md` を手動で修正してください。`/video-start` で生成され、その後 `/video-finish` 実行時に自動で反映されます。

### 字幕が遅れて表示される / 動画と同期しない

→ `jetcut.mp4` と `cut_plan.json` の duration がズレている可能性があります。以下で再生成:

```bash
rm "work/<name>/jetcut.mp4" "work/<name>/cut_plan.json"
npm run main -- "input/<name>.mp4"
```

### Premiere Pro で読み込みエラーが出る

考えられる原因:
1. **音声が鳴らない**: 古い jetcut.mp4 の DTS 問題。`work/<name>/jetcut.mp4` を削除して再生成
2. **動画が3秒しか読めない**: 同じく DTS 問題。jetcut を再生成
3. **FCP XML エラー**: `timeline.xml` を再生成（`/video-export-edit` を再実行）

### Bロール画像に英語テキストが入る

→ Vision OCR 検証が ON になっていれば、自動でリトライされます。`config/style.json` で:

```jsonc
"imageVerify": true,
"imageMaxAttempts": 3
```

それでも入る場合は `imageStyleGuide` をさらに厳しく書き換えてください。

### Renoise クレジットが足りない

→ クレジット残高は以下で確認:

```bash
node ~/.claude/plugins/marketplaces/renoise-plugins-official/skills/renoise-gen/renoise-cli.mjs credit me
```

不足する場合は https://www.renoise.ai でクレジット追加。

### ディスク容量が足りない

→ `/video-list` で容量を確認 → 完成済み動画の `/video-cleanup <name>` で `work/` を整理。

---

## コストの目安

### 1動画あたりの典型コスト（5分の素材）

| 項目 | 量 | 単価 | 小計 |
|---|---|---|---|
| Whisper 文字起こし | 5分 | $0.006/分 | **約 $0.03** (4円) |
| Gemini Pro (Bロール計画+ハイライト+概要欄) | 3〜5回 | 無料枠 | **0円** |
| Gemini Vision (画像検証) | 3〜8枚 | 無料枠 | **0円** |
| NanoBanana 2 (画像生成) | 3〜8枚 | $0.045/枚 | **約 $0.36** (54円) |
| Renoise (動画 Bロール) | 3本 (各8秒) | 約 160 クレジット/本 | **480 クレジット** |

**合計**: 約 60円 + Renoise 480 クレジット

### 月間試算

- **週1本ペース** (月4本): $2 + Renoise 1,920 クレジット
- **週3本ペース** (月12本): $7 + Renoise 5,760 クレジット

### Renoise クレジットの目安

- 5秒動画: 100 クレジット
- 7秒動画: 140 クレジット
- 8秒動画: 160 クレジット
- 15秒動画（最大）: 300 クレジット

残高は `/video-list` 実行時、または以下のコマンドで確認:

```bash
node ~/.claude/plugins/marketplaces/renoise-plugins-official/skills/renoise-gen/renoise-cli.mjs credit me
```

---

## 直接 CLI から実行する場合

スラッシュコマンドを使わず、ターミナルから直接実行することも可能:

```bash
# 文字起こしまで
npm run preprocess -- "input/動画.mp4"

# 本編動画
npm run main -- "input/動画.mp4"

# ショート動画 2 本
npm run short -- "input/動画.mp4" 2

# 編集ソフト用素材
npm run export-edit -- "input/動画.mp4"

# YouTube 概要欄
npm run youtube -- "input/動画.mp4"

# 管理系
npm run list
npm run cleanup -- "input/動画.mp4"
npm run archive -- "input/動画.mp4"
```

---

## まとめ: 推奨フロー

1. **準備**: `input/` に動画を置く
2. **`/video-start <input>`** → 文字起こし完了まで待つ
3. **`work/<name>/transcript_edit.md` を修正** → 固有名詞・カタカナ語を直す
4. **`/video-finish <input>`** → 焼き込み版本編動画を生成
5. **`/edit-short <input> 2`** → ショート動画 2 本を生成
6. **`/video-description <input>`** → YouTube 概要欄を生成
7. **必要なら `/video-export-edit <input>`** → Premiere/Filmora で追加編集
8. **完成後 `/video-cleanup <name>`** → 中間ファイル整理

これで AI/IT 解説動画 1 本を 30 分〜1 時間で完成させられます。

何か問題があれば `CLAUDE.md` または `config/README.md` を参照、または Claude Code に質問してください。
