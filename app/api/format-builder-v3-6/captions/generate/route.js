import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const SONGS_DIR = path.join(process.cwd(), "public", "songs");
const FORMATS_DIR = path.join(process.cwd(), "data", "song-formats-v3-6");
const DEFAULT_STYLE = {
  mode: "default", // default | cutout | negative
  color: "#ffffff",
  fontFamily: "Montserrat",
  fontWeight: "800",
  fontSizeRatio: 0.25,
  letterSpacing: 0,
  animation: "word", // word | chunk
  chunkRule: "line",
};
const DEFAULT_DISPLAY_RANGES = [];

function slugify(name) {
  return name
    .replace(/\.mp3$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function findSongPath(slug) {
  if (!fs.existsSync(SONGS_DIR)) return null;
  const entry = fs
    .readdirSync(SONGS_DIR)
    .find((file) => slugify(file) === slug && file.toLowerCase().endsWith(".mp3"));
  return entry ? path.join(SONGS_DIR, entry) : null;
}

function loadFormat(slug) {
  if (!fs.existsSync(FORMATS_DIR)) {
    fs.mkdirSync(FORMATS_DIR, { recursive: true });
  }
  const formatPath = path.join(FORMATS_DIR, `${slug}.json`);
  if (!fs.existsSync(formatPath)) {
    return {
      format: {
        source: "",
        meta: { durationSeconds: 0, bpm: null },
        segmentGrid: [],
        beatGrid: [], // legacy alias
        sections: [],
        rapidClipRanges: [],
        mixSegments: [],
        segmentMetadata: [],
        beatMetadata: [], // legacy alias
        introBeat: null, // legacy intro naming
        captions: null,
        createdAt: null,
        updatedAt: null,
      },
      exists: false,
      formatPath,
    };
  }
  const parsed = JSON.parse(fs.readFileSync(formatPath, "utf-8"));
  return { format: parsed, exists: true, formatPath };
}

function groupWordsIntoLines(words) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const lines = [];
  let buffer = [];
  let startMs = words[0].start;
  for (const word of words) {
    if (buffer.length === 0) {
      startMs = word.start;
    }
    buffer.push(word);
    const isTerminal =
      /[.?!]/.test(word.text.slice(-1)) || buffer.length >= 8 || word === words[words.length - 1];
    if (isTerminal) {
      lines.push({
        text: buffer.map((w) => w.text).join(" "),
        startMs,
        endMs: word.end,
        words: buffer.map((w, idx) => idx),
      });
      buffer = [];
    }
  }
  return lines;
}

async function uploadToAssembly(filePath, apiKey) {
  const buffer = await fs.promises.readFile(filePath);
  const res = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/octet-stream",
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${text}`);
  }
  const data = await res.json();
  if (!data.upload_url) throw new Error("Upload response missing upload_url");
  return data.upload_url;
}

async function requestTranscript(uploadUrl, apiKey) {
  const res = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: uploadUrl,
      punctuate: true,
      format_text: true,
      word_boost: [],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Transcript request failed: ${text}`);
  }
  const data = await res.json();
  if (!data.id) throw new Error("Transcript response missing id");
  return data.id;
}

async function pollTranscript(id, apiKey) {
  const MAX_ATTEMPTS = 60;
  const DELAY_MS = 2000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const res = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: apiKey },
    });
    const data = await res.json();
    if (data.status === "completed") return data;
    if (data.status === "error") {
      throw new Error(data.error || "Transcription failed");
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
  throw new Error("Transcription polling timed out");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { slug } = body || {};

    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }
    // Support both variants; env.example uses ASSEMBLY_AI_API_KEY
    const apiKey =
      process.env.ASSEMBLYAI_API_KEY || process.env.ASSEMBLY_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing ASSEMBLYAI_API_KEY / ASSEMBLY_AI_API_KEY env" },
        { status: 500 }
      );
    }

    const songPath = findSongPath(slug);
    if (!songPath) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 });
    }

    const { format, formatPath, exists } = loadFormat(slug);
    const requestedAt = new Date().toISOString();

    const uploadUrl = await uploadToAssembly(songPath, apiKey);
    const transcriptId = await requestTranscript(uploadUrl, apiKey);
    const transcript = await pollTranscript(transcriptId, apiKey);

    const words = Array.isArray(transcript.words)
      ? transcript.words.map((w) => ({
          text: w.text,
          startMs: w.start,
          endMs: w.end,
          confidence: w.confidence,
        }))
      : [];

    const lines = groupWordsIntoLines(transcript.words || []);
    const defaultStyle = format.captions?.style || DEFAULT_STYLE;
    const defaultDisplayRanges = format.captions?.displayRanges || DEFAULT_DISPLAY_RANGES;

    const captions = {
      provider: "assemblyai",
      status: "ready",
      requestedAt,
      updatedAt: new Date().toISOString(),
      language: transcript.language_code || "en",
      words,
      lines: lines.map((line) => ({
        text: line.text,
        startMs: line.startMs,
        endMs: line.endMs,
      })),
      style: defaultStyle,
      displayRanges: defaultDisplayRanges,
      transcriptId,
    };

    const nextFormat = {
      ...format,
      captions,
      updatedAt: new Date().toISOString(),
      createdAt: format.createdAt || requestedAt,
    };

    fs.writeFileSync(formatPath, JSON.stringify(nextFormat, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      slug,
      exists,
      captions,
      format: nextFormat,
    });
  } catch (error) {
    console.error("[format-builder/captions/generate] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to generate captions" },
      { status: 500 }
    );
  }
}
