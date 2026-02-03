#!/usr/bin/env node
/**
 * Quick availability check for Cloudinary cutout assets.
 *
 * What it does:
 * - Uses the new account by default: cloud name from
 *   NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME (fallbacks: CLOUDINARY_CLOUD_NAME or
 *   "attention-engine").
 * - If a clip pool file is present (default: data/instantClipPool2.json),
 *   extracts all cutout images (meta.cutoutImageMap.processedAssetId) and
 *   checks their PNG URLs.
 * - Also checks a few hardcoded URLs used in the editor (MOV/WEBM/PNG).
 * - Performs HEAD with GET fallback when HEAD is rejected.
 *
 * CLI:
 *   node scripts/check_cutouts.mjs [urls...] [--pool path] [--max N] [--cloud name]
 *
 * Examples:
 *   node scripts/check_cutouts.mjs                    # pool + defaults
 *   node scripts/check_cutouts.mjs --max 10           # limit checks
 *   node scripts/check_cutouts.mjs --pool ./path.json # custom pool file
 *   node scripts/check_cutouts.mjs --cloud my-cloud   # override cloud
 *   node scripts/check_cutouts.mjs https://res...     # only these URLs
 */

import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function parseArgs(argv) {
  const args = { urls: [], pool: null, max: null, cloud: null };
  const items = [...argv];
  while (items.length) {
    const v = items.shift();
    if (v === "--pool") {
      args.pool = items.shift();
    } else if (v === "--max") {
      args.max = Number(items.shift());
    } else if (v === "--cloud") {
      args.cloud = items.shift();
    } else if (v.startsWith("--")) {
      continue;
    } else {
      args.urls.push(v);
    }
  }
  return args;
}

const parsed = parseArgs(process.argv.slice(2));

const cloudName =
  parsed.cloud ||
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
  process.env.CLOUDINARY_CLOUD_NAME ||
  "attention-engine";

const poolPath =
  parsed.pool || path.join(process.cwd(), "data", "instantClipPool2.json");

const cliUrls = parsed.urls;

const defaults = [
  {
    label: "cutout-png",
    url: `https://res.cloudinary.com/${cloudName}/image/upload/v1769119748/Kill_Bill_Vol1_Part2_30FPS_CUTOUTtest_mcxzly.png`,
  },
  {
    label: "cutout-mov",
    url: `https://res.cloudinary.com/${cloudName}/video/upload/v1769119748/Kill_Bill_Vol1_Part2_30FPS_CUTOUTtest_mcxzly.mov`,
  },
  {
    label: "cutout-webm-alpha",
    url: `https://res.cloudinary.com/${cloudName}/video/upload/v1769119748/f_webm,vc_vp9,fl_preserve_transparency,q_auto:best/Kill_Bill_Vol1_Part2_30FPS_CUTOUTtest_mcxzly.webm`,
  },
];

function loadPoolCutouts(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    const clips = Array.isArray(data?.clips) ? data.clips : [];
    const collected = [];
    for (const clip of clips) {
      const map = clip?.meta?.cutoutImageMap;
      if (!map?.processedAssetId) continue;
      if (clip.cutoutImage !== true) continue;
      const id = map.processedAssetId;
      collected.push({
        label: `pool:${clip.id || id}`,
        url: `https://res.cloudinary.com/${cloudName}/image/upload/${id}.png`,
      });
    }
    return collected;
  } catch (err) {
    console.error("Failed to parse pool file:", err);
    return [];
  }
}

const poolTargets = loadPoolCutouts(poolPath);

const targetsFromInputs = cliUrls.length
  ? cliUrls.map((url, i) => ({ label: `cli-${i + 1}`, url }))
  : [...defaults, ...poolTargets];

// Deduplicate by URL
const seen = new Set();
const deduped = [];
for (const t of targetsFromInputs) {
  if (seen.has(t.url)) continue;
  seen.add(t.url);
  deduped.push(t);
}

const maxToCheck =
  typeof parsed.max === "number" && !Number.isNaN(parsed.max)
    ? Math.max(parsed.max, 1)
    : null;

const targets = maxToCheck ? deduped.slice(0, maxToCheck) : deduped;

async function checkUrl(target) {
  const headersOnly = { method: "HEAD" };
  const fallbackGet = { method: "GET" };

  const attempt = async (init) => {
    const res = await fetch(target.url, init);
    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type"),
      contentLength: res.headers.get("content-length"),
    };
  };

  try {
    let result = await attempt(headersOnly);
    if (result.status === 405) {
      result = await attempt(fallbackGet);
    }
    return { ...target, ...result };
  } catch (error) {
    return { ...target, ok: false, status: "error", error: String(error) };
  }
}

async function main() {
  console.log(`Cloud name: ${cloudName}`);
  console.log(`Pool file: ${poolTargets.length ? poolPath : "none/failed"}`);
  console.log(`Checking ${targets.length} target(s)...\n`);

  const results = [];
  for (const t of targets) {
    const res = await checkUrl(t);
    results.push(res);
    // Small delay to avoid hammering
    await delay(150);
  }

  for (const r of results) {
    if (r.ok) {
      console.log(
        `${r.label}: OK ${r.status} | type=${r.contentType || "n/a"} | size=${r.contentLength || "n/a"} | ${r.url}`
      );
    } else {
      console.log(
        `${r.label}: FAIL ${r.status} | ${r.error || "non-200"} | ${r.url}`
      );
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
