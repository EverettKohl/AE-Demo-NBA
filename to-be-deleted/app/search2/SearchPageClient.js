"use client";

import { useState } from "react";
import SearchBar from "@/components/SearchBar";
import SearchResults from "@/components/SearchResults";

export default function SearchPageClient() {
  const [textSearchQuery, setTextSearchQuery] = useState("");
  const [textSearchSubmitted, setTextSearchSubmitted] = useState(false);
  const [searchMode] = useState("quick");
  const [updatedSearchData, setUpdatedSearchData] = useState({
    searchData: [],
    pageInfo: {},
  });

  const handleTextSubmit = async (textInputValue) => {
    setTextSearchQuery(textInputValue);
    setTextSearchSubmitted(true);
  };

  const clearQueryAndResults = () => {
    setUpdatedSearchData({ searchData: [], pageInfo: {} });
    setTextSearchQuery("");
    setTextSearchSubmitted(false);
  };

  return (
    <div className="min-h-screen bg-black">
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-indigo-400 uppercase tracking-wide">Search</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-100">Find Kill Bill moments</h1>
          <p className="text-slate-400 max-w-2xl">
            Use text or an image to jump straight to scenes, dialogue, and action beats across both volumes.
          </p>
        </div>

        <div className="bg-gray-900 rounded-xl border-2 border-gray-700 overflow-hidden shadow-2xl ring-1 ring-gray-600/50">
          <SearchBar clearQueryAndResults={clearQueryAndResults} handleTextSubmit={handleTextSubmit} searchMode={searchMode} setSearchMode={null} />
        </div>

        {textSearchSubmitted ? (
          <SearchResults
            updatedSearchData={updatedSearchData}
            setUpdatedSearchData={setUpdatedSearchData}
            textSearchQuery={textSearchQuery}
            textSearchSubmitted={textSearchSubmitted}
            searchMode={searchMode}
          />
        ) : (
          <div className="bg-gray-950 border border-gray-800 rounded-2xl px-6 py-10 text-center text-slate-400">
            Start typing or drop an image above to let the AI surface the exact Kill Bill moments you need.
            Download links will appear on each generated clip.
          </div>
        )}
      </main>
    </div>
  );
}
