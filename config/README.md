# Style configuration

このディレクトリは動画編集パイプラインの **見た目とAI生成挙動の正典** です。

## ルール

- 字幕フォント、サイズ、色、Bロール表示方法、画像/動画生成のスタイルなどを変更したいときは **必ず [`style.json`](style.json) を編集** する
- パイプライン全体（FFmpeg / Gemini / Remotion）が起動時にこのファイルを読み込む
- 編集後は再レンダリングするだけで反映される（`npm run main -- input/xxx.mp4` または `/edit-main`）
- このファイルを編集してもキャッシュ済みの素材（preprocess / jetcut / broll plan）は再利用される。スタイル変更だけならコストはゼロ円

## ファイル構成

| キー | 役割 |
|---|---|
| `fonts` | フォントのエイリアス。`japanese` / `english` を定義しておき、各セクションから参照する |
| `subtitles.main` | 16:9 本編動画の字幕スタイル |
| `subtitles.short` | 9:16 ショート動画の字幕スタイル |
| `broll.defaultMode` | Bロールの既定表示モード（`pip` または `fullscreen`） |
| `broll.pip` | PiP モード時の枠サイズ・位置・装飾 |
| `broll.fullscreen` | フルスクリーンモード時の背景・フィット方法 |
| `shortVideo.title` | ショート動画上部のタイトルテロップ |
| `shortVideo.hookText` | タイトル下のフック1行 |
| `generation.imageStyleGuide` | Gemini 画像生成プロンプトに毎回付け加えるスタイル指示 |
| `generation.videoStyleGuide` | Renoise 動画生成プロンプトに毎回付け加えるスタイル指示 |
| `generation.language` | 生成されたテキストの言語（`ja` 固定推奨） |

## Bロール表示モード

各 Bロールクリップは `pip` (Picture-in-Picture) または `fullscreen` (画面切り替え) で表示できます。

- **pip**: 元の画面収録を残したまま、右上などに小さく重ねる。補助的なイラスト・図解向け
- **fullscreen**: Bロール期間中は元の画面を完全に置き換える。重要な動画・関連シーン向け

各クリップの表示モードは Gemini が文脈から自動判定します。判定が無い場合は `broll.defaultMode` に従います。手動で固定したい場合は `work/<name>/broll_plan.json` の `displayMode` フィールドを編集してから再レンダリングしてください。

## 比率（Ratio）の意味

`fontSizeRatio: 0.030` のような値は **コンポジション幅に対する比率** です。例えば 1920px の本編なら `1920 × 0.030 = 57px`、1080px のショートなら `1080 × 0.030 = 32px` になります。これにより 1080p 横と 1080p 縦の両方で自動的に良い感じに収まります。

## フォント変更例

```jsonc
{
  "fonts": {
    "japanese": "Yu Gothic, Hiragino Sans, sans-serif"  // ← Yu Gothic を優先
  }
}
```

または直接フォント名を文字列で指定:

```jsonc
{
  "subtitles": {
    "main": {
      "fontFamily": "Klee One, cursive"  // ← 'japanese' エイリアスを使わず直接指定
    }
  }
}
```

> macOS 上の Chromium がインストール済みのフォントをそのまま使えます。確実性が必要なら `public/fonts/` に .ttf を置いて `@font-face` で読み込む拡張も可能です。

## 画像生成の品質制御

`config/style.json` の `generation` ブロックには、画像生成の品質を制御するパラメータがあります:

| キー | 値 | 説明 |
|---|---|---|
| `imagePrimaryModel` | `"gemini"` または `"renoise"` | 最初に使う画像生成モデル |
| `imageFallbackModel` | `"gemini"` / `"renoise"` / `"none"` | Primary が検証に失敗した時のフォールバック |
| `imageMaxAttempts` | 整数 (推奨3) | 全モデル合計の最大試行回数 |
| `imageVerify` | `true` / `false` | Gemini Vision で生成画像を OCR 検証するか |
| `imageAspectRatio` | `"16:9"` / `"9:16"` / `"1:1"` | 生成画像の縦横比 |
| `imageResolution` | `"1k"` / `"2k"` | 解像度（Renoise のみ有効） |

### 検証の仕組み

`imageVerify: true` にすると、画像を生成するたびに Gemini Vision (`gemini-2.5-flash`) が自動でその画像を検査して、以下の項目をレポートします:

- 英語テキストが入っていないか
- 日本語が壊れていないか
- 画像全体の品質

検証に失敗すると、次の試行では「テキストを一切入れない」という指示に切り替えて再生成します。それでも失敗する場合、`imageFallbackModel` に切り替えて最終試行します。

### モデルの選択

| モデル | 特徴 |
|---|---|
| **gemini** (gemini-2.5-flash-image) | 速い、安い、英語混入リスクやや高め |
| **renoise** (nano-banana-2) | やや遅い、Renoise クレジット消費、2k 解像度可 |

デフォルトは Primary=Gemini、Fallback=Renoise です。両方を組み合わせることで、どちらか片方のクセを相互補完できます。

## 画像/動画の見た目を変える

`generation.imageStyleGuide` と `generation.videoStyleGuide` を編集すると、Gemini と Renoise への全ての生成リクエストに自動でその指示が付加されます。

例: もっとアニメ寄りにしたい場合

```jsonc
{
  "generation": {
    "imageStyleGuide": "Cute Japanese anime / 2D animation style. Soft pastel colors, hand-drawn line art. All on-screen text must be natural Japanese."
  }
}
```

変更後、`work/<name>/broll_plan.json` を一度削除してから `npm run main -- input/xxx.mp4` を再実行すると、新しいスタイルガイドで Bロールが作り直されます。
