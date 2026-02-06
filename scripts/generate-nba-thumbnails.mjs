#!/usr/bin/env node
/**
 * Generate mid-frame thumbnails for NBA clips used in the Generate Edit 2 animation.
 * - Selects 200 clips balanced across players (at least one per source video).
 * - Captures the midpoint frame from each clip via Cloudinary and saves a .webp.
 * - Emits metadata to app/editor3/animation/nba-clip-thumbnails.json.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DATA_PATH = path.join(ROOT, "data", "AllClips2.json");
const OUTPUT_DIR = path.join(ROOT, "public", "animation", "NBAThumbnails");
const METADATA_PATH = path.join(ROOT, "app", "editor3", "animation", "nba-clip-thumbnails.json");

const TARGET_TOTAL = 200;
const FALLBACK_CLOUD_NAME = "attention-engine";
const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || FALLBACK_CLOUD_NAME;

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const sanitizeName = (value) => `${value}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_");

const groupBy = (items, keyFn) =>
  items.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(item);
    return acc;
  }, new Map());

const pickClipsForPlayer = (clips, target) => {
  const sorted = [...clips].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const byVideo = groupBy(sorted, (c) => c.cloudinaryId || c.cloudinaryPublicId || c.videoId || c.playerTag);

  const chosen = [];
  const used = new Set();

  // Seed with one midpoint clip from every source video to ensure coverage.
  for (const group of byVideo.values()) {
    const mid = group[Math.floor(group.length / 2)];
    if (mid && !used.has(mid.id)) {
      chosen.push(mid);
      used.add(mid.id);
    }
  }

  const remaining = target - chosen.length;
  if (remaining > 0) {
    const step = sorted.length / remaining;
    for (let i = 0; i < remaining; i++) {
      let idx = Math.min(sorted.length - 1, Math.floor(step * i + step / 2));
      let guard = 0;
      while (used.has(sorted[idx].id) && guard < sorted.length) {
        idx = (idx + 1) % sorted.length;
        guard += 1;
      }
      const pick = sorted[idx];
      if (pick && !used.has(pick.id)) {
        chosen.push(pick);
        used.add(pick.id);
      }
    }
  }

  return chosen.slice(0, target);
};

const downloadWithConcurrency = async (tasks, limit = 8) => {
  let idx = 0;
  let active = 0;
  let resolved = 0;

  return new Promise((resolve, reject) => {
    const launchNext = () => {
      if (resolved === tasks.length) return resolve();
      while (active < limit && idx < tasks.length) {
        const current = idx++;
        active += 1;
        tasks[current]()
          .then(() => {
            active -= 1;
            resolved += 1;
            launchNext();
          })
          .catch(reject);
      }
    };
    launchNext();
  });
};

const main = async () => {
  const data = await readJson(DATA_PATH);
  const clips = Array.isArray(data?.clips) ? data.clips : [];
  if (!clips.length) {
    throw new Error("No clips found in AllClips2.json");
  }

  const byPlayer = groupBy(
    clips.filter((c) => c?.playerTag),
    (c) => sanitizeName(c.playerTag)
  );

  const players = Array.from(byPlayer.keys());
  if (!players.length) {
    throw new Error("No playerTag values found in clips");
  }

  const playerWeights = data?.distribution?.byPlayer || {};
  const baseTarget = Math.floor(TARGET_TOTAL / players.length);
  const remainder = TARGET_TOTAL - baseTarget * players.length;
  const playersByWeight = [...players].sort((a, b) => (playerWeights[b] || 0) - (playerWeights[a] || 0));
  const extraPlayers = new Set(playersByWeight.slice(0, remainder));

  const perPlayerTarget = Object.fromEntries(players.map((p) => [p, baseTarget + (extraPlayers.has(p) ? 1 : 0)]));

  const selections = [];
  for (const player of players) {
    const target = perPlayerTarget[player] || baseTarget;
    const chosen = pickClipsForPlayer(byPlayer.get(player) || [], target);
    if (chosen.length !== target) {
      throw new Error(`Failed to pick ${target} clips for ${player}, got ${chosen.length}`);
    }
    selections.push(...chosen);
  }

  if (selections.length !== TARGET_TOTAL) {
    throw new Error(`Expected ${TARGET_TOTAL} total selections, got ${selections.length}`);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const counters = new Map();
  const metadata = [];
  const downloadTasks = selections.map((clip) => {
    const player = sanitizeName(clip.playerTag);
    const count = (counters.get(player) || 0) + 1;
    counters.set(player, count);

    const midpoint = ((Number(clip.start) || 0) + (Number(clip.end) || 0)) / 2;
    const frameTime = Number.isFinite(midpoint) ? Number(midpoint.toFixed(3)) : 0;
    const filename = `${player}-${String(count).padStart(3, "0")}.webp`;
    const destPath = path.join(OUTPUT_DIR, filename);
    const cloudinaryId = clip.cloudinaryPublicId || clip.cloudinaryId || clip.cloudinaryUrl || clip.id;
    const downloadUrl = `https://res.cloudinary.com/${cloudName}/video/upload/so_${frameTime},q_auto,f_webp/${cloudinaryId}.webp`;

    metadata.push({
      id: clip.id,
      src: `/animation/NBAThumbnails/${filename}`,
      cloudinaryId,
      start: frameTime,
      playerTag: player,
    });

    return async () => {
      const res = await fetch(downloadUrl);
      if (!res.ok) {
        throw new Error(`Download failed for ${filename}: ${res.status} ${res.statusText}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(destPath, buf);
      process.stdout.write(`Saved ${filename}\n`);
    };
  });

  await downloadWithConcurrency(downloadTasks, 8);

  const sortedMetadata = metadata.sort((a, b) => {
    if (a.playerTag === b.playerTag) return a.src.localeCompare(b.src);
    return a.playerTag.localeCompare(b.playerTag);
  });

  await fs.writeFile(METADATA_PATH, JSON.stringify(sortedMetadata, null, 2));
  process.stdout.write(`\nDone. Wrote ${sortedMetadata.length} thumbnails and metadata to ${METADATA_PATH}\n`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
