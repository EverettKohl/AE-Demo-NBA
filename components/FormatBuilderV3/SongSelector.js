"use client";

import { useEffect, useState } from "react";

const SongSelector = ({ selectedSong, onSelect, disabled, defaultSlug }) => {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSongs = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/format-builder-v3/songs");
        if (!res.ok) throw new Error("Failed to load songs");
        const data = await res.json();
        setSongs(data.songs || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchSongs();
  }, []);

  useEffect(() => {
    if (!defaultSlug || !songs.length || selectedSong) return;
    const match = songs.find((s) => s.slug === defaultSlug);
    if (match) {
      onSelect(match);
    }
  }, [defaultSlug, songs, selectedSong, onSelect]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm">
        <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
        Loading songs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-400 text-sm">Error: {error}</div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="text-amber-400 text-sm">
        No songs found. Add .mp3 files to <code className="bg-gray-800 px-1 rounded">public/songs/</code>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-slate-200">
        Select Song
      </label>
      <select
        value={selectedSong?.slug || ""}
        onChange={(e) => {
          const song = songs.find((s) => s.slug === e.target.value);
          onSelect(song || null);
        }}
        disabled={disabled}
        className="w-full border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent disabled:opacity-50"
        style={{ backgroundColor: "#ffffff", color: "#111827" }}
      >
        <option value="" style={{ color: "#6b7280" }}>-- Choose a song --</option>
        {songs.map((song) => (
          <option key={song.slug} value={song.slug} style={{ backgroundColor: "#ffffff", color: "#111827" }}>
            {song.displayName}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SongSelector;

