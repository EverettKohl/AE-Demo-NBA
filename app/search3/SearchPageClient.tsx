"use client";

import { FormEvent, useMemo, useState } from "react";

type ClipResult = {
  id: string;
  start: number;
  end: number;
  clipUrl: string | null;
  thumbnail: string | null;
  videoId: string | null;
  confidence: number | null;
};

const formatSeconds = (value: number) => {
  if (!Number.isFinite(value)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const normalizeResults = (payload: any): ClipResult[] => {
  const items = Array.isArray(payload?.results) ? payload.results : [];

  return items.map((item, index) => {
    const start = Number(item.start ?? 0);
    const end = Number(item.end ?? start + 5);
    const id = item.id || `${item.videoId || item.video_id || "clip"}-${start}-${end}-${index}`;

    let confidence: number | null = null;
    if (typeof item.confidence === "number") {
      confidence = item.confidence;
    } else if (item.confidence !== undefined) {
      const numeric = Number(item.confidence);
      confidence = Number.isFinite(numeric) ? numeric : null;
    }

    return {
      id,
      start,
      end,
      videoId: item.videoId || item.video_id || null,
      clipUrl: item.clipUrl || item.clip_url || null,
      thumbnail: item.thumbnail_url || item.thumbnailUrl || null,
      confidence,
    };
  });
};

export default function SearchPageClient() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClipResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const summary = useMemo(() => {
    if (!results.length) return null;
    return `${results.length} clip${results.length === 1 ? "" : "s"} found`;
  }, [results]);

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Enter a search term.");
      return;
    }

    setLoading(true);
    setError(null);
    setPlayingId(null);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, limit: 12 }),
      });

      if (!response.ok) {
        throw new Error("Search failed. Please try again.");
      }

      const data = await response.json();
      const normalized = normalizeResults(data);
      setResults(normalized);

      if (!normalized.length) {
        setError("No results found.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed. Please try again.";
      setError(message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-slate-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400">Search 3</p>
          <h1 className="text-3xl font-bold sm:text-4xl">Twelve Labs clip search</h1>
          <p className="text-sm text-slate-400">
            Search the Kill Bill Twelve Labs index, preview results, and play any returned clip.
          </p>
        </header>

        <form
          onSubmit={handleSearch}
          className="flex flex-col gap-3 rounded-2xl border border-gray-800 bg-gray-950/80 p-4 shadow-xl sm:flex-row sm:items-center sm:gap-4"
        >
          <label className="sr-only" htmlFor="searchQuery">
            Search Twelve Labs
          </label>
          <input
            id="searchQuery"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe the moment you want to find..."
            className="h-12 w-full rounded-xl border border-gray-800 bg-gray-900 px-4 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}

        {summary && (
          <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-2 text-sm text-slate-300">{summary}</div>
        )}

        <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((clip) => {
            const isActive = playingId === clip.id;
            const hasClip = Boolean(clip.clipUrl);
            const thumbnail = clip.thumbnail || "/search.gif";

            return (
              <article
                key={clip.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-950 shadow-lg transition hover:-translate-y-1 hover:border-indigo-500/40 hover:shadow-indigo-500/10"
              >
                <div className="relative aspect-video w-full bg-black">
                  {hasClip && isActive ? (
                    <video
                      className="h-full w-full object-cover"
                      src={clip.clipUrl ?? undefined}
                      poster={thumbnail}
                      controls
                      autoPlay
                      playsInline
                    />
                  ) : (
                    <img src={thumbnail} alt="Clip preview" className="h-full w-full object-cover" />
                  )}

                  {!isActive && hasClip && (
                    <button
                      type="button"
                      onClick={() => setPlayingId(clip.id)}
                      className="absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-[1px] transition hover:bg-black/50"
                    >
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/40 bg-black/70 shadow-xl">
                        <svg className="ml-1 h-6 w-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </button>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-3 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-slate-200">
                      {formatSeconds(clip.start)} – {formatSeconds(clip.end)}
                    </div>
                    {clip.confidence !== null && (
                      <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs text-indigo-200">
                        {Math.round(clip.confidence * 100)}% match
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span className="truncate" title={clip.videoId || "Twelve Labs video"}>
                      {clip.videoId || "Twelve Labs video"}
                    </span>
                    {isActive && hasClip && (
                      <button
                        type="button"
                        onClick={() => setPlayingId(null)}
                        className="rounded-lg border border-gray-800 px-3 py-1 text-xs font-semibold text-slate-100 hover:border-indigo-400"
                      >
                        Stop
                      </button>
                    )}
                  </div>

                  {!hasClip && (
                    <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-slate-400">
                      No playable clip returned for this result.
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        {!loading && !results.length && !error && (
          <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/70 px-6 py-10 text-center text-slate-400">
            Enter a search to see Twelve Labs clip matches.
          </div>
        )}
      </main>
    </div>
  );
}
