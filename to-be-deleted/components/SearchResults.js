import React, { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import SearchResultList from "./SearchResultList";
import LoadingSpinner from "./LoadingSpinner";
import ErrorFallback from "./ErrorFallback";

const SearchResults = ({ updatedSearchData, setUpdatedSearchData, textSearchQuery, textSearchSubmitted, searchMode = "quick" }) => {
  const queryClient = useQueryClient();

  const fetchTextSearchResults = async (query) => {
    const response = await fetch(`/api/textSearch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ textSearchQuery: query, searchMode }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Network response was not ok");
    }

    return response.json();
  };

  const {
    data: textSearchResultData,
    isLoading: textSearchResultLoading,
    error: textSearchError,
  } = useQuery({
    queryKey: ["textSearch", textSearchQuery, searchMode],
    queryFn: () => fetchTextSearchResults(textSearchQuery),
    enabled: textSearchSubmitted,
    keepPreviousData: true,
  });

  useEffect(() => {
    if (textSearchSubmitted) {
      queryClient.invalidateQueries(["textSearch", textSearchQuery]);
    }
  }, [textSearchSubmitted, textSearchQuery, queryClient]);

  if (textSearchError) {
    return <ErrorFallback error={textSearchError} />;
  }

  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <div className="w-full">
        {textSearchResultLoading ? (
          <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-50">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-8 flex flex-col items-center gap-4 border border-gray-800">
              <LoadingSpinner size="lg" color="primary" />
              <p className="text-slate-600 dark:text-slate-300 font-medium">Searching videos...</p>
            </div>
          </div>
        ) : textSearchSubmitted && textSearchResultData?.pageInfo?.total_results > 0 ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100">Search Results</h2>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-full">
                  <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                    {textSearchResultData?.pageInfo?.total_results}{" "}
                    {textSearchResultData?.pageInfo?.total_results === 1 ? "match" : "matches"}
                  </span>
                </div>
              </div>
            </div>
            <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
              <SearchResultList
                searchResultData={textSearchResultData}
                updatedSearchData={updatedSearchData}
                setUpdatedSearchData={setUpdatedSearchData}
              />
            </div>
          </>
        ) : (
          <div className="min-h-[60vh] flex justify-center items-center py-16">
            <div className="flex flex-col items-center justify-center max-w-md mx-auto px-4">
              <div className="w-24 h-24 mb-6 rounded-full bg-gray-950 flex items-center justify-center">
                <svg className="w-12 h-12 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">No results found</h3>
              <p className="text-center text-slate-600 dark:text-slate-400 mb-6">
                We couldn&apos;t find any moments matching your query. Try different natural language terms or search with an image.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors font-medium"
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default SearchResults;
