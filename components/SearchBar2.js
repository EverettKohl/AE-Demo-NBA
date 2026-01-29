"use client";
import React, { useRef, useState } from "react";
import TextSearchForm from "./TextSearchForm2";

const SearchBar2 = ({ clearQueryAndResults, handleTextSubmit, searchMode = "quick", setSearchMode }) => {
  const inputRef = useRef(null);
  const [showModeTooltip, setShowModeTooltip] = useState(false);

  const handleTextFormSubmit = (evt) => {
    evt.preventDefault();
    if (inputRef.current.value.length > 0) {
      handleTextSubmit(inputRef.current.value, searchMode);
    }
  };

  const onClear = () => {
    inputRef.current.value = "";
    clearQueryAndResults();
  };

  return (
    <div className="w-full px-4 md:px-6 py-4 bg-gray-900 flex flex-col gap-3">
      {/* Search Mode Selector (disabled if no setSearchMode) */}
      {setSearchMode && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 mr-2">Search Mode:</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button
              onClick={() => setSearchMode("quick")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                searchMode === "quick" ? "bg-indigo-600 text-white" : "bg-gray-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              ⚡ Quick
            </button>
            <button
              onClick={() => setSearchMode("detailed")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                searchMode === "detailed" ? "bg-amber-600 text-white" : "bg-gray-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              🔍 Detailed
            </button>
          </div>
          <div className="relative">
            <button
              onMouseEnter={() => setShowModeTooltip(true)}
              onMouseLeave={() => setShowModeTooltip(false)}
              className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showModeTooltip && (
              <div className="absolute left-0 top-full mt-1 w-64 p-3 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 text-xs">
                <p className="font-semibold text-slate-200 mb-2">Search Modes:</p>
                <p className="text-slate-400 mb-2">
                  <span className="text-indigo-400 font-medium">⚡ Quick:</span> Fast direct search using TwelveLabs. Best for simple queries.
                </p>
                <p className="text-slate-400">
                  <span className="text-amber-400 font-medium">🔍 Detailed:</span> AI-powered search using the Kill Bill Agent. Better context understanding but slower.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center flex-grow min-w-0">
          <div className="flex items-center justify-center mr-3 md:mr-4 flex-shrink-0">
            <button
              className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950"
              onClick={handleTextFormSubmit}
              aria-label="Search"
            >
              <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
          <TextSearchForm handleTextFormSubmit={handleTextFormSubmit} inputRef={inputRef} />
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {inputRef.current?.value && (
            <button
              onClick={onClear}
              className="p-1.5 rounded-lg hover:bg-gray-800 transition-colors text-gray-500 hover:text-gray-300"
              aria-label="Clear search"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <div className="w-px h-8 bg-gray-700" />
        </div>
      </div>
    </div>
  );
};

export default SearchBar2;
