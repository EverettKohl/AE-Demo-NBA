import React from "react";
import Link from "next/link";

const ErrorFallback = ({ error }) => {
  const message = error?.message || error?.error || String(error || "Something went wrong.");

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 px-4 text-center">
      <div className="rounded-2xl border border-red-500/40 bg-red-950/40 px-6 py-5 shadow-lg max-w-lg w-full">
        <div className="flex items-center justify-center gap-2 text-red-200 font-semibold mb-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 4.93l14.14 14.14" />
          </svg>
          <span>Something went wrong</span>
        </div>
        <p className="text-sm text-red-100/90 break-words">{message}</p>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          Reload
        </button>
        <Link
          href="/"
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 transition-colors"
        >
          Home
        </Link>
      </div>
    </div>
  );
};

export default ErrorFallback;
