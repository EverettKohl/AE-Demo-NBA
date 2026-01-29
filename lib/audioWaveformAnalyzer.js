/**
 * Audio Waveform Analyzer
 *
 * Provides detailed audio analysis with multiple frequency bands for visualization.
 * Generates waveform data suitable for rendering in the timeline.
 *
 * Features:
 * - Overall volume/amplitude envelope
 * - Frequency band separation (sub-bass, bass, low-mids, mids, high-mids, treble, brilliance)
 * - Beat/onset detection
 * - Spectral flux for energy changes
 */

import fs from "fs";
import path from "path";
import { parseFile } from "music-metadata";
import { spawn, execSync } from "child_process";

/**
 * Get the ffmpeg binary path
 */
const getFFmpegPath = () => {
  const staticPath = path.join(
    process.cwd(),
    "node_modules",
    "ffmpeg-static",
    process.platform === "darwin"
      ? "ffmpeg"
      : process.platform === "win32"
      ? "ffmpeg.exe"
      : "ffmpeg"
  );
  if (fs.existsSync(staticPath)) return staticPath;

  try {
    const systemPath = execSync("which ffmpeg", { encoding: "utf8" }).trim();
    if (systemPath && fs.existsSync(systemPath)) return systemPath;
  } catch {}

  const brewPath = "/opt/homebrew/bin/ffmpeg";
  if (fs.existsSync(brewPath)) return brewPath;

  const brewPathIntel = "/usr/local/bin/ffmpeg";
  if (fs.existsSync(brewPathIntel)) return brewPathIntel;

  throw new Error("ffmpeg not found");
};

const ffmpegPath = getFFmpegPath();
const TARGET_SAMPLE_RATE = 44100;

// Frequency band definitions (Hz)
const FREQUENCY_BANDS = {
  subBass: { min: 20, max: 60, color: "#9333ea", label: "Sub Bass" },
  bass: { min: 60, max: 250, color: "#ec4899", label: "Bass" },
  lowMids: { min: 250, max: 500, color: "#f97316", label: "Low Mids" },
  mids: { min: 500, max: 2000, color: "#eab308", label: "Mids" },
  highMids: { min: 2000, max: 4000, color: "#22c55e", label: "High Mids" },
  treble: { min: 4000, max: 8000, color: "#06b6d4", label: "Treble" },
  brilliance: { min: 8000, max: 20000, color: "#3b82f6", label: "Brilliance" },
};

/**
 * Decode audio to PCM
 */
const decodeToPCM = (songPath) =>
  new Promise((resolve, reject) => {
    const args = [
      "-i",
      songPath,
      "-ac",
      "1",
      "-ar",
      `${TARGET_SAMPLE_RATE}`,
      "-f",
      "s16le",
      "-hide_banner",
      "-loglevel",
      "error",
      "pipe:1",
    ];

    const proc = spawn(ffmpegPath, args);
    const chunks = [];
    let stderr = "";

    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });

/**
 * Simple FFT implementation for frequency analysis
 * Using a basic DFT for simplicity - works well for visualization purposes
 */
const computeFFT = (samples) => {
  const N = samples.length;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);

  // Compute DFT
  for (let k = 0; k < N; k++) {
    let sumReal = 0;
    let sumImag = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      sumReal += samples[n] * Math.cos(angle);
      sumImag -= samples[n] * Math.sin(angle);
    }
    real[k] = sumReal;
    imag[k] = sumImag;
  }

  // Compute magnitudes
  const magnitudes = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    magnitudes[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]) / N;
  }

  return magnitudes;
};

/**
 * Apply a bandpass filter to samples using frequency domain
 */
const getBandEnergy = (magnitudes, sampleRate, fftSize, minFreq, maxFreq) => {
  const binResolution = sampleRate / fftSize;
  const minBin = Math.floor(minFreq / binResolution);
  const maxBin = Math.ceil(maxFreq / binResolution);

  let energy = 0;
  let count = 0;

  for (let i = minBin; i <= maxBin && i < magnitudes.length; i++) {
    energy += magnitudes[i] * magnitudes[i];
    count++;
  }

  return count > 0 ? Math.sqrt(energy / count) : 0;
};

/**
 * Build waveform data with frequency bands
 * @param {Int16Array} int16 - PCM samples
 * @param {number} sampleRate - Sample rate
 * @param {number} windowMs - Analysis window in milliseconds
 * @param {number} targetPoints - Target number of points in output
 * @returns {Object} - Waveform data for each band
 */
const buildWaveformData = (int16, sampleRate, windowMs = 50, targetPoints = 500) => {
  const totalSamples = int16.length;
  const durationSeconds = totalSamples / sampleRate;

  // Calculate window size - we want targetPoints data points
  const samplesPerPoint = Math.floor(totalSamples / targetPoints);
  const fftSize = 2048; // Power of 2 for FFT

  // Initialize output arrays
  const numPoints = Math.min(targetPoints, Math.floor(totalSamples / samplesPerPoint));
  const volume = new Float32Array(numPoints);
  const bands = {};

  Object.keys(FREQUENCY_BANDS).forEach((band) => {
    bands[band] = new Float32Array(numPoints);
  });

  // Process each window
  for (let i = 0; i < numPoints; i++) {
    const startSample = i * samplesPerPoint;
    const endSample = Math.min(startSample + samplesPerPoint, totalSamples);

    // Calculate RMS for volume
    let sumSquares = 0;
    for (let j = startSample; j < endSample; j++) {
      const sample = int16[j] / 32768;
      sumSquares += sample * sample;
    }
    volume[i] = Math.sqrt(sumSquares / (endSample - startSample));

    // For frequency analysis, take a window for FFT
    const fftStart = Math.max(0, startSample);
    const fftEnd = Math.min(fftStart + fftSize, totalSamples);
    const windowSamples = new Float32Array(fftSize);

    for (let j = 0; j < fftSize; j++) {
      const idx = fftStart + j;
      if (idx < fftEnd) {
        // Apply Hann window for smoother results
        const hannWindow = 0.5 * (1 - Math.cos((2 * Math.PI * j) / (fftSize - 1)));
        windowSamples[j] = (int16[idx] / 32768) * hannWindow;
      }
    }

    // Compute FFT
    const magnitudes = computeFFT(windowSamples);

    // Extract energy for each frequency band
    Object.entries(FREQUENCY_BANDS).forEach(([band, { min, max }]) => {
      bands[band][i] = getBandEnergy(magnitudes, sampleRate, fftSize, min, max);
    });
  }

  // Normalize all bands to 0-1 range
  const normalizeArray = (arr) => {
    const maxVal = Math.max(...arr);
    if (maxVal === 0) return Array.from(arr);
    return Array.from(arr).map((v) => v / maxVal);
  };

  // Calculate spectral flux (rate of change in frequency content)
  const spectralFlux = new Float32Array(numPoints);
  for (let i = 1; i < numPoints; i++) {
    let flux = 0;
    Object.keys(bands).forEach((band) => {
      const diff = bands[band][i] - bands[band][i - 1];
      if (diff > 0) flux += diff;
    });
    spectralFlux[i] = flux;
  }

  // Detect onsets (sharp increases in energy)
  const onsets = [];
  const onsetThreshold = computeAdaptiveThreshold(spectralFlux);
  for (let i = 1; i < numPoints; i++) {
    if (spectralFlux[i] > onsetThreshold[i] && spectralFlux[i] > spectralFlux[i - 1]) {
      const time = (i * samplesPerPoint) / sampleRate;
      onsets.push({
        time: Number(time.toFixed(3)),
        strength: spectralFlux[i],
      });
    }
  }

  return {
    volume: normalizeArray(volume),
    bands: Object.fromEntries(
      Object.entries(bands).map(([band, data]) => [band, normalizeArray(data)])
    ),
    spectralFlux: normalizeArray(spectralFlux),
    onsets,
    pointDuration: durationSeconds / numPoints,
    numPoints,
    durationSeconds,
  };
};

/**
 * Compute adaptive threshold for onset detection
 */
const computeAdaptiveThreshold = (data) => {
  const windowSize = 10;
  const multiplier = 1.5;
  const threshold = new Float32Array(data.length);

  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(data.length, i + windowSize);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += data[j];
    }
    const mean = sum / (end - start);
    threshold[i] = mean * multiplier;
  }

  return threshold;
};

/**
 * Detect beats using onset strength
 */
const detectBeats = (onsets, minSpacing = 0.2) => {
  const beats = [];
  let lastBeat = -Infinity;

  // Sort by strength descending
  const sortedOnsets = [...onsets].sort((a, b) => b.strength - a.strength);

  for (const onset of sortedOnsets) {
    if (onset.time - lastBeat >= minSpacing) {
      beats.push(onset.time);
      lastBeat = onset.time;
    }
  }

  return beats.sort((a, b) => a - b);
};

/**
 * Analyze audio file and return detailed waveform data
 * @param {string} songPath - Path to the audio file
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} - Complete waveform analysis
 */
export const analyzeWaveform = async (songPath, options = {}) => {
  const { targetPoints = 500 } = options;

  if (!fs.existsSync(songPath)) {
    throw new Error(`Audio file not found: ${songPath}`);
  }

  // Get metadata
  const meta = await parseFile(songPath);
  const duration = meta.format.duration || 0;

  if (duration === 0) {
    throw new Error("Could not determine audio duration");
  }

  // Decode to PCM
  const pcmBuffer = await decodeToPCM(songPath);
  const int16 = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    pcmBuffer.byteLength / Int16Array.BYTES_PER_ELEMENT
  );

  // Build waveform data
  const waveformData = buildWaveformData(int16, TARGET_SAMPLE_RATE, 50, targetPoints);

  // Detect beats from onsets
  const beats = detectBeats(waveformData.onsets);

  return {
    ...waveformData,
    beats,
    bandDefinitions: FREQUENCY_BANDS,
    meta: {
      durationSeconds: Number(duration.toFixed(3)),
      sampleRate: TARGET_SAMPLE_RATE,
      analyzedAt: new Date().toISOString(),
    },
  };
};

export default { analyzeWaveform, FREQUENCY_BANDS };
