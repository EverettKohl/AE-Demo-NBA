"use client";

import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { DownloadProvider } from "@/components/DownloadProgress";
import ThemeProvider from "./ThemeProvider2";

const enableDevtools = typeof window !== "undefined" && process.env.NEXT_PUBLIC_ENABLE_DEVTOOLS === "true";
const ReactQueryDevtools = enableDevtools
  ? dynamic(() => import("@tanstack/react-query-devtools").then((mod) => mod.ReactQueryDevtools), { ssr: false, loading: () => null })
  : null;

export default function Providers2({ children }) {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    const isMetaMaskError = (event) => {
      const message = event?.message || event?.reason?.message || event?.reason;
      const stack = event?.filename || event?.reason?.stack;
      return (
        (typeof message === "string" && message.includes("Failed to connect to MetaMask")) ||
        (typeof stack === "string" && stack.includes("chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn"))
      );
    };

    const handleError = (event) => {
      if (isMetaMaskError(event)) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
      }
    };

    const handleUnhandledRejection = (event) => {
      if (isMetaMaskError(event)) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
      }
    };

    window.addEventListener("error", handleError, true);
    window.addEventListener("unhandledrejection", handleUnhandledRejection, true);

    return () => {
      window.removeEventListener("error", handleError, true);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection, true);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <DownloadProvider>
          {children}
          {ReactQueryDevtools ? <ReactQueryDevtools initialIsOpen={false} /> : null}
        </DownloadProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
