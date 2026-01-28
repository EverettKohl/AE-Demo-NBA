import fs from "fs";
import path from "path";
import { loadVariantManifest } from "./instantVariants";

const PUBLIC_ROOT = path.join(process.cwd(), "public", "instant-edits");

const safeDuration = (start, end) => Math.max(0, (end || 0) - (start || 0));
const MIN_PART_DURATION = 0.25;
const EPS = 1e-3;

const hasFile = (url) => {
  if (!url) return false;
  const abs = path.join(process.cwd(), "public", url.replace(/^\//, ""));
  return fs.existsSync(abs);
};

const isValidPart = (part) => {
  if (!part?.renderUrl || !hasFile(part.renderUrl)) return false;
  const dur = safeDuration(part.startSeconds, part.endSeconds || part.durationSeconds);
  return dur + EPS >= MIN_PART_DURATION;
};

export const computeInstantReadiness = (songSlug) => {
  if (!songSlug) {
    return { ready: false, reasons: ["songSlug missing"] };
  }
  const manifest = loadVariantManifest(songSlug);
  const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
  const validParts = parts.filter(isValidPart);
  if (!validParts.length) {
    return {
      ready: false,
      totalVariantCount: 0,
      validVariantCount: 0,
      reasons: ["No valid parts generated"],
      partCounts: { intro: 0, body: 0, outro: 0 },
      combinatorial: 0,
    };
  }

  const requiredParts = ["intro", "body", "outro"];
  const partBuckets = {
    intro: [],
    body: [],
    outro: [],
  };

  validParts.forEach((p) => {
    const type = (p.partType || "").toLowerCase();
    if (!partBuckets[type]) return;
    const url = p.renderUrl;
    const abs = url ? path.join(process.cwd(), "public", url.replace(/^\//, "")) : null;
    const fileExists = abs ? fs.existsSync(abs) : false;
    partBuckets[type].push({
      partId: p.id,
      renderUrl: url,
      fileExists,
      startSeconds: p.startSeconds || 0,
      endSeconds: p.endSeconds || p.durationSeconds || 0,
      durationSeconds: safeDuration(p.startSeconds, p.endSeconds || p.durationSeconds),
    });
  });

  const partCounts = Object.fromEntries(requiredParts.map((p) => [p, partBuckets[p]?.length || 0]));
  const missingParts = requiredParts.filter((p) => (partBuckets[p] || []).length === 0);
  const missingFiles = [];
  requiredParts.forEach((p) => {
    (partBuckets[p] || []).forEach((entry) => {
      if (!entry.fileExists) {
        missingFiles.push(`${p}:${entry.renderUrl || "n/a"}`);
      }
    });
  });

  const combinatorial = requiredParts.reduce((acc, p) => acc * Math.max(0, partCounts[p] || 0), 1);

  const durations = [];
  validParts.forEach((p) => {
    durations.push(safeDuration(p.startSeconds, p.endSeconds || p.durationSeconds));
  });
  const durationMin = durations.length ? Math.min(...durations) : null;
  const durationMax = durations.length ? Math.max(...durations) : null;

  const reasons = [];
  if (missingParts.length) reasons.push(`Missing parts: ${missingParts.join(", ")}`);
  if (missingFiles.length) reasons.push(`Part files missing: ${missingFiles.join(", ")}`);
  if (combinatorial === 0) reasons.push("No combinatorial variants");

  const ready = !missingParts.length && !missingFiles.length && combinatorial > 0;

  return {
    ready,
    reasons,
    totalVariantCount: parts.length,
    validVariantCount: validParts.length,
    partCounts,
    combinatorial,
    durationMin,
    durationMax,
  };
};
