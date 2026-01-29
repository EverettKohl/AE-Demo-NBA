import fs from "fs";
import path from "path";

import { analyzeWaveform } from "./audioWaveformAnalyzer";

/**
 * Derive a BPM estimate from a list of beat timestamps.
 */
const deriveBpm = (beatGrid) => {
  if (!Array.isArray(beatGrid) || beatGrid.length < 2) return { bpm: null, confidence: null };

  // Compute intervals between consecutive beats
  const intervals = [];
  for (let i = 1; i < beatGrid.length; i++) {
    const delta = beatGrid[i] - beatGrid[i - 1];
    if (delta > 0) intervals.push(delta);
  }
  if (!intervals.length) return { bpm: null, confidence: null };

  // Use median interval for a resilient estimate
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const bpm = median > 0 ? Math.round((60 / median) * 100) / 100 : null;

  // Rough confidence: spread of intervals vs median
  const mean =
    intervals.reduce((sum, val) => sum + val, 0) / (intervals.length || 1);
  const variance =
    intervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    (intervals.length || 1);
  const stdDev = Math.sqrt(variance);
  const confidence =
    median > 0 ? Math.max(0, Math.min(1, 1 - stdDev / median)) : 0;

  return {
    bpm,
    confidence: confidence.toFixed(2),
  };
};

/**
 * Analyze an audio file and return beat grid + metadata.
 * @param {string} songPath absolute path to file
 * @param {{minSpacing?: number}} opts
 */
export const analyzeSong = async (songPath, opts = {}) => {
  const { minSpacing = 0.3 } = opts;

  if (!songPath) {
    throw new Error("songPath is required");
  }
  const resolvedPath = path.isAbsolute(songPath)
    ? songPath
    : path.join(process.cwd(), songPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Audio file not found: ${resolvedPath}`);
  }

  // Analyze waveform + beats
  const waveform = await analyzeWaveform(resolvedPath, { targetPoints: 700 });
  const beats = Array.isArray(waveform.beats) ? waveform.beats : [];

  // Enforce min spacing between beats if provided
  const beatGrid = [];
  for (const time of beats) {
    if (!beatGrid.length || time - beatGrid[beatGrid.length - 1] >= minSpacing) {
      beatGrid.push(Number(time.toFixed(3)));
    }
  }

  const { bpm, confidence } = deriveBpm(beatGrid);

  return {
    beatGrid,
    meta: {
      durationSeconds: waveform.meta?.durationSeconds ?? null,
      bpm,
      bpmConfidence: confidence,
      beatCount: beatGrid.length,
      analyzedAt: waveform.meta?.analyzedAt ?? new Date().toISOString(),
    },
  };
};

export default { analyzeSong };
