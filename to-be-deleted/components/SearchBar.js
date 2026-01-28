"use client";
import React, { useRef, useState } from "react";
import TextSearchForm from "./TextSearchForm";

/**
 *
 * Home -> { SearchBar } -> { TextSearchForm }
 *
 */
const SearchBar = ({
  clearQueryAndResults,
  handleTextSubmit,
  searchMode = "quick",
  setSearchMode,
}) => {
  const inputRef = useRef(null);
  const [showModeTooltip, setShowModeTooltip] = useState(false);

  /** Set text search query as input value and update text search submit status */
  const handleTextFormSubmit = (evt) => {
    evt.preventDefault();
    if (inputRef.current.value.length > 0) {
      handleTextSubmit(inputRef.current.value, searchMode);
    }
  };

  /** Clear query and results  */
  const onClear = () => {
    inputRef.current.value = "";
    clearQueryAndResults();
  };

  return (
    <div className="w-full px-4 md:px-6 py-4 bg-gray-900 flex flex-col gap-3">
      {/* Search Mode Selector */}
      {/* Search mode selector removed; always using quick mode */}
      
      {/* Search Input Row */}
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
          <TextSearchForm
            handleTextFormSubmit={handleTextFormSubmit}
            inputRef={inputRef}
          />
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

export default SearchBar;
