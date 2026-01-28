"use client";

import React, { useState, useEffect } from "react";
import SearchBar from "./ui/SearchBar";
import SearchResultList from "./ui/SearchResultList";
import LoadingSpinner from "./LoadingSpinner";

const ReplaceModal = ({ segmentIndex, onSave, onCancel, isClipDisabled = null, getClipDisabledReason = null }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [searchResultData, setSearchResultData] = useState(null); // Raw API response
  const [updatedSearchData, setUpdatedSearchData] = useState({
    searchData: [],
    pageInfo: {},
  }); // Processed data with video details
  const [selectedClip, setSelectedClip] = useState(null);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [isSearching, setIsSearching] = useState(false);

  const handleTextSubmit = async (textInputValue) => {
    if (!textInputValue || textInputValue.trim().length === 0) {
      setSearchError("Please enter a search query");
      return;
    }
    
    setSearchQuery(textInputValue);
    setSearchSubmitted(true);
    setSelectedClip(null);
    setSelectedClipId(null);
    setSearchError(null);
    setIsSearching(true);
    
    try {
      const res = await fetch("/api/textSearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textSearchQuery: textInputValue }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Search failed");
      }

      const payload = await res.json();
      // Store raw API response - SearchResultList will process it
      setSearchResultData({
        textSearchResults: payload.textSearchResults || [],
        pageInfo: payload.pageInfo || {},
      });
      setUpdatedSearchData({ searchData: [], pageInfo: {} }); // Reset processed data
      setSearchError(null);
    } catch (error) {
      console.error("Search error:", error);
      setSearchError(error.message || "Failed to search. Please try again.");
      setSearchResultData(null);
      setUpdatedSearchData({ searchData: [], pageInfo: {} });
    } finally {
      setIsSearching(false);
    }
  };

  const clearQueryAndResults = () => {
    setSearchQuery("");
    setSearchResultData(null);
    setUpdatedSearchData({ searchData: [], pageInfo: {} });
    setSearchSubmitted(false);
    setSelectedClip(null);
    setSelectedClipId(null);
    setSearchError(null);
  };

  const handleClipSelect = (clip, index) => {
    // Ensure clip has required data
    if (!clip || (!clip.video_id && !clip.videoId)) {
      console.error("Invalid clip selected:", clip);
      return;
    }
    
    setSelectedClip(clip);
    setSelectedClipId(`${clip.video_id || clip.videoId}-${index}`);
  };

  const handleSave = async () => {
    if (!selectedClip) {
      setSearchError("Please select a clip to replace with");
      return;
    }

    // Validate clip has required fields
    if (typeof selectedClip.start !== "number" || typeof selectedClip.end !== "number") {
      setSearchError("Selected clip is missing start or end time");
      return;
    }

    if (selectedClip.end <= selectedClip.start) {
      setSearchError("Selected clip has invalid time range");
      return;
    }

    setIsSaving(true);
    setSearchError(null);
    
    try {
      // Get video detail to ensure we have all necessary info
      // Use existing videoDetail if available, otherwise fetch it
      let videoDetail = selectedClip.videoDetail;
      
      if (!videoDetail) {
        const videoDetailRes = await fetch(`/api/getVideo?videoId=${selectedClip.video_id || selectedClip.videoId}`);
        if (!videoDetailRes.ok) {
          throw new Error("Failed to fetch video detail");
        }
        videoDetail = await videoDetailRes.json();
      }

      // Prepare replacement clip data
      // Note: indexId will be set by the API route if not provided
      const replacementClip = {
        videoId: selectedClip.video_id || selectedClip.videoId,
        video_id: selectedClip.video_id || selectedClip.videoId,
        indexId: selectedClip.indexId || videoDetail?.indexId || null, // Will use default in API if null
        start: selectedClip.start,
        end: selectedClip.end,
        videoDetail,
        confidence: selectedClip.confidence,
        thumbnail_url: selectedClip.thumbnail_url || selectedClip.thumbnailUrl,
      };

      onSave(segmentIndex, replacementClip);
    } catch (error) {
      console.error("Error saving replacement:", error);
      setSearchError(`Failed to save replacement: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <div className="h-full flex flex-col bg-gray-950">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 bg-gray-900/50">
          <div className="flex items-center justify-between">
            <button
              onClick={onCancel}
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors group"
              aria-label="Cancel"
            >
              <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-medium">Cancel</span>
            </button>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-white">Replace Clip {segmentIndex + 1}</h1>
              <p className="text-xs text-slate-400 mt-0.5">Search and select a replacement clip</p>
            </div>
            <div className="w-24 flex justify-end">
              {selectedClip && (
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSaving ? "Saving..." : "Save Replacement"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="bg-gray-900 border-b border-gray-800">
          <SearchBar
            clearQueryAndResults={clearQueryAndResults}
            handleTextSubmit={handleTextSubmit}
          />
        </div>

        {/* Search Results */}
        <div className="flex-1 overflow-y-auto">
          {searchError && (
            <div className="p-4 bg-red-900/20 border-b border-red-700/50">
              <p className="text-sm text-red-200">{searchError}</p>
            </div>
          )}
          {isSearching ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <LoadingSpinner size="lg" />
                <p className="text-slate-400 mt-4">Searching...</p>
              </div>
            </div>
          ) : searchSubmitted && searchResultData && (!searchResultData.textSearchResults || searchResultData.textSearchResults.length === 0) && (!updatedSearchData.searchData || updatedSearchData.searchData.length === 0) ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-lg font-semibold text-white mb-2">No Results Found</h3>
                <p className="text-slate-400">
                  Try a different search query or check your spelling.
                </p>
              </div>
            </div>
          ) : searchResultData && ((searchResultData.textSearchResults && searchResultData.textSearchResults.length > 0) || (updatedSearchData.searchData && updatedSearchData.searchData.length > 0)) ? (
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-white mb-2">
                  Search Results {selectedClip && <span className="text-sm text-emerald-400">(Clip selected)</span>}
                </h2>
                <p className="text-sm text-slate-400">
                  Click on a clip to select it, then click &quot;Save Replacement&quot; above
                </p>
              </div>
              <SearchResultList
                searchResultData={searchResultData}
                updatedSearchData={updatedSearchData}
                setUpdatedSearchData={setUpdatedSearchData}
                onClipSelect={handleClipSelect}
                selectedClipId={selectedClipId}
                isClipDisabled={isClipDisabled}
                getClipDisabledReason={getClipDisabledReason}
              />
              {selectedClip && (
                <div className="mt-4 p-4 bg-emerald-900/20 border border-emerald-700/50 rounded-lg">
                  <p className="text-sm text-emerald-200">
                    <strong>Clip selected:</strong> {selectedClip.videoDetail?.system_metadata?.video_title || selectedClip.videoDetail?.system_metadata?.filename || "Unknown"} 
                    ({selectedClip.start?.toFixed(2)}s - {selectedClip.end?.toFixed(2)}s)
                  </p>
                  <p className="text-xs text-emerald-300/80 mt-1">
                    You can use &quot;Adjust &amp; Download&quot; to fine-tune the clip before saving.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <h3 className="text-lg font-semibold text-white mb-2">Search for a Replacement Clip</h3>
                <p className="text-slate-400">
                  Use the search bar above to find clips. You can search by text description or upload an image.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReplaceModal;

