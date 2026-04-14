/**
 * Stage 6 — Edit-export bundle.
 *
 * Builds a self-contained `output/edit/<name>/` folder that contains every
 * file a human editor needs to finish the video in Premiere Pro / Filmora /
 * DaVinci Resolve / Final Cut Pro. Unlike the burned-in `/video-finish`
 * pipeline, this stage NEVER bakes subtitles or B-roll into the video — it
 * simply organizes the existing intermediates and emits editor-friendly
 * sidecar files.
 *
 * Outputs:
 *   output/edit/<name>/jetcut.mp4         (copied from work)
 *   output/edit/<name>/subtitles.srt      (chunked, post-jetcut timeline)
 *   output/edit/<name>/subtitles.ass      (styled, same chunking)
 *   output/edit/<name>/timeline.xml    (cut + markers, FCP7 schema)
 *   output/edit/<name>/timeline.edl       (CMX 3600, Filmora-friendly)
 *   output/edit/<name>/markers.csv        (B-roll + highlight markers)
 *   output/edit/<name>/markers.json
 *   output/edit/<name>/broll/             (Gemini/Renoise assets)
 *   output/edit/<name>/README.md
 *
 * Usage: npm run export-edit -- input/demo.mp4
 */

import fs from "node:fs";
import path from "node:path";
import {
  ensureWorkspace,
  editExportFor,
} from "./lib/paths.js";
import { probeDuration } from "./lib/ffmpeg.js";
import { remapTranscript } from "./lib/timeline.js";
import { loadStyle, chunkTranscript } from "./lib/style.js";
import { applyTranscriptEdit } from "./lib/transcript-edit.js";
import { run } from "./lib/shell.js";
import {
  writeSrt,
  writeAss,
  writeFcpXml,
  writeEdl,
  writeMarkersCsv,
  writeMarkersJson,
  type Marker,
} from "./lib/edit-exporters.js";
import type { Transcript } from "./lib/whisper.js";
import type { SpeechRange } from "./lib/ffmpeg.js";

async function runStage(name: string, cmd: string, args: string[]) {
  console.log(`\n=== ${name} ===`);
  await run(cmd, args);
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npm run export-edit -- <input-video>");
    process.exit(1);
  }
  const absInput = path.resolve(input);
  if (!fs.existsSync(absInput)) {
    console.error(`input not found: ${absInput}`);
    process.exit(1);
  }

  const ws = ensureWorkspace(absInput);
  const out = editExportFor(absInput);
  fs.mkdirSync(out.dir, { recursive: true });
  fs.mkdirSync(out.brollDir, { recursive: true });

  const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");

  // 1. Make sure the upstream stages are done. Each is cached.
  if (!fs.existsSync(ws.transcript)) {
    await runStage("preprocess", tsxBin, ["scripts/01-preprocess.ts", absInput]);
  } else {
    console.log("[export-edit] preprocess cached");
  }
  if (!fs.existsSync(ws.jetcut) || !fs.existsSync(ws.cutPlan)) {
    await runStage("jetcut", tsxBin, ["scripts/02-jetcut.ts", absInput]);
  } else {
    console.log("[export-edit] jetcut cached");
  }
  if (!fs.existsSync(ws.brollPlan)) {
    await runStage("broll", tsxBin, ["scripts/03-broll.ts", absInput]);
  } else {
    console.log("[export-edit] broll plan cached");
  }

  // 2. Load all the artifacts we need.
  const rawTranscript = JSON.parse(fs.readFileSync(ws.transcript, "utf8")) as Transcript;
  const editedTranscript = applyTranscriptEdit(rawTranscript, ws.transcriptEdit);
  const { ranges } = JSON.parse(fs.readFileSync(ws.cutPlan, "utf8")) as {
    ranges: SpeechRange[];
  };
  const style = loadStyle();
  const cutTranscript = chunkTranscript(
    remapTranscript(editedTranscript, ranges),
    style.subtitles.chunking,
  );

  const brollPlan = JSON.parse(fs.readFileSync(ws.brollPlan, "utf8")) as Array<{
    id: string;
    kind: "image" | "video";
    displayMode?: "pip" | "fullscreen";
    cutStartSec: number;
    cutEndSec: number;
    topic: string;
    assetFile?: string;
  }>;

  const highlights = fs.existsSync(ws.highlights)
    ? (JSON.parse(fs.readFileSync(ws.highlights, "utf8")) as Array<{
        startSec: number;
        endSec: number;
        title: string;
        hookText: string;
        reason: string;
      }>)
    : [];

  const jetcutDuration = await probeDuration(ws.jetcut);

  // 3. Copy jetcut.mp4 into the export bundle.
  // We copy (not symlink) so the bundle is fully portable to other
  // machines / cloud storage. Skip if the destination is already up to date.
  const srcStat = fs.statSync(ws.jetcut);
  let needsCopy = true;
  if (fs.existsSync(out.jetcut)) {
    const dstStat = fs.statSync(out.jetcut);
    if (dstStat.size === srcStat.size && dstStat.mtimeMs >= srcStat.mtimeMs) {
      needsCopy = false;
    }
  }
  if (needsCopy) {
    console.log(`[export-edit] copying jetcut.mp4 → ${out.jetcut}`);
    fs.copyFileSync(ws.jetcut, out.jetcut);
  } else {
    console.log("[export-edit] jetcut.mp4 already up to date");
  }

  // 4. Copy any B-roll assets that exist.
  const brollFiles = fs.existsSync(ws.brollDir) ? fs.readdirSync(ws.brollDir) : [];
  for (const f of brollFiles) {
    const src = path.join(ws.brollDir, f);
    const dst = path.join(out.brollDir, f);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, dst);
  }
  if (brollFiles.length > 0) {
    console.log(`[export-edit] copied ${brollFiles.length} B-roll assets → ${out.brollDir}`);
  }

  // 5. Write SRT (chunked) and ASS (chunked, styled).
  writeSrt(cutTranscript, out.srt);
  console.log(`[export-edit] subtitles.srt → ${out.srt}`);

  writeAss(cutTranscript, out.ass, {
    fontName: "Hiragino Sans W9",
    fontSize: Math.floor(1080 * style.subtitles.main.fontSizeRatio),
    marginV: Math.floor(1080 * style.subtitles.main.bottomRatio),
    videoWidth: 1920,
    videoHeight: 1080,
  });
  console.log(`[export-edit] subtitles.ass → ${out.ass}`);

  // 6. Build markers from B-roll plan + highlights.
  const markers: Marker[] = [];
  for (const b of brollPlan) {
    markers.push({
      timeSec: b.cutStartSec,
      durationSec: b.cutEndSec - b.cutStartSec,
      type: "broll",
      label: `B-roll: ${b.topic}`,
      notes: `${b.kind} (${b.displayMode ?? "fullscreen"}) — ${b.id}`,
    });
  }
  for (const h of highlights) {
    markers.push({
      timeSec: h.startSec,
      durationSec: h.endSec - h.startSec,
      type: "highlight",
      label: `Highlight: ${h.title}`,
      notes: h.hookText + (h.reason ? ` / ${h.reason}` : ""),
    });
  }
  // Stable order: by time
  markers.sort((a, b) => a.timeSec - b.timeSec);

  writeMarkersCsv(markers, out.markersCsv);
  writeMarkersJson(markers, out.markersJson);
  console.log(
    `[export-edit] markers.csv + markers.json → ${markers.length} markers`,
  );

  // 7. Write FCP XML and EDL referencing the bundled jetcut.mp4.
  const fcpxml = writeFcpXml({
    videoFile: out.jetcut,
    videoWidth: 1920,
    videoHeight: 1080,
    fps: 30,
    durationSec: jetcutDuration,
    sequenceName: ws.base,
    markers,
  });
  fs.writeFileSync(out.fcpxml, fcpxml);
  console.log(`[export-edit] timeline.xml → ${out.fcpxml}`);

  const edl = writeEdl({
    title: ws.base,
    fps: 30,
    durationSec: jetcutDuration,
    reelName: "JETCUT",
  });
  fs.writeFileSync(out.edl, edl);
  console.log(`[export-edit] timeline.edl → ${out.edl}`);

  // 8. Write a README explaining what's in the bundle.
  const readme = `# 編集ソフト用エクスポート: ${ws.base}

このフォルダには **${ws.base}** をPremiere Pro / Filmora / DaVinci Resolve / Final Cut Pro で編集するための全ファイルが入っています。テロップやBロールは **動画には焼き込まれていません**。すべて編集ソフト側で合成してください。

## ファイル一覧

| ファイル | 用途 |
|---|---|
| \`jetcut.mp4\` | 無音区間を除去した本編動画。これを編集ソフトに読み込む |
| \`subtitles.srt\` | 字幕（チャンク単位）。Premiere/Filmora/DaVinci で字幕トラックとして読み込み |
| \`subtitles.ass\` | 字幕（スタイル付き）。Filmora / DaVinci 等で見栄えを保ったまま読み込める |
| \`timeline.xml\` | カット位置 + マーカー入りのシーケンス（FCP7 XML）。Premiere/DaVinci/FCP X が読み込み可 |
| \`timeline.edl\` | CMX 3600 EDL。古めのPremiereやFilmoraでカット情報を読み込む用 |
| \`markers.csv\` | Bロール挿入位置 + ハイライト位置の表（スプレッドシート向け） |
| \`markers.json\` | 同上の JSON 版 |
| \`broll/\` | 生成済みBロール画像/動画。Premiere に手動で配置する |

## Premiere Pro での使い方

1. プロジェクトを開く
2. \`ファイル → 読み込み\` で \`jetcut.mp4\` を読み込む
3. \`ファイル → 読み込み\` で \`subtitles.srt\` を字幕トラックとして読み込む
4. \`ファイル → 読み込み → XML\` で \`timeline.xml\` を読み込むとマーカーが反映される
5. \`markers.csv\` を見ながら BGM・効果音を配置
6. \`broll/\` 内の素材を必要な箇所にドラッグ＆ドロップ

## Filmora での使い方

1. 新規プロジェクトを作成
2. \`jetcut.mp4\` と \`subtitles.srt\` をメディアパネルに追加
3. \`subtitles.srt\` をタイムラインの字幕トラックにドラッグ
4. \`markers.csv\` を別途開いてマーカー位置を確認
5. \`broll/\` 内の素材を必要な箇所に配置
6. （任意）\`subtitles.ass\` を読み込むとスタイル付き字幕として使える

## マーカーの種類

- **broll**: Geminiが「ここでBロール挿入を推奨」と判定した位置
- **highlight**: ショート動画候補位置（盛り上がりポイント）

## 字幕について

字幕はチャンク方式（10〜15文字）で生成されています。フォントは config/style.json の設定に基づき、Filmora や DaVinci ではそのまま見栄えよく表示されます。

## 元動画

- 入力: \`${path.basename(absInput)}\`
- 出力ジェットカット長: ${jetcutDuration.toFixed(2)}秒

---
このバンドルは \`npm run export-edit -- input/${path.basename(absInput)}\` または \`/video-export-edit\` で再生成できます。
`;
  fs.writeFileSync(out.readme, readme);

  console.log(`\n[export-edit] done → ${out.dir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
