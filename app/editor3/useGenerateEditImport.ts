"use client";

import { useEffect, useMemo, useState } from "react";
import { prefetchImportAssets } from "./useQuickEdit6Import";

export const GE_IMPORT_PARAM = "geImport";

type GenerateEditImportPayload = any;

const readStoredImport = (key: string): GenerateEditImportPayload | null => {
  if (typeof window === "undefined" || !key) return null;
  const sources = [window.sessionStorage, window.localStorage];
  for (const store of sources) {
    try {
      const raw = store.getItem(`ge-import-${key}`);
      if (!raw) continue;
      return JSON.parse(raw) as GenerateEditImportPayload;
    } catch (err) {
      console.warn("[useGenerateEditImport] Failed to parse payload", err);
    }
  }
  return null;
};

export function useGenerateEditImport(paramName: string = GE_IMPORT_PARAM): {
  project: GenerateEditImportPayload | null;
  loading: boolean;
  error: string | null;
} {
  const [project, setProject] = useState<GenerateEditImportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const controller = new AbortController();
    let cancelled = false;
    const searchParams = new URLSearchParams(window.location.search);
    const key = searchParams.get(paramName);
    if (!key) {
      setLoading(false);
      return;
    }

    const loadImport = async () => {
      try {
        const res = await fetch(`/api/editor-imports/${encodeURIComponent(key)}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.rveProject) {
            try {
              const localized = await prefetchImportAssets(data.rveProject as any, controller.signal);
              if (controller.signal.aborted || cancelled) return;
              if (typeof window !== "undefined") {
                try {
                  const payloadStr = JSON.stringify(localized);
                  window.sessionStorage.setItem(`ge-import-${key}`, payloadStr);
                  window.localStorage.setItem(`ge-import-${key}`, payloadStr);
                } catch {
                  /* ignore storage errors */
                }
              }
              setProject(localized as any);
              setLoading(false);
              return;
            } catch (err: any) {
              setError(err?.message || "Failed to download clips (2GB limit?)");
              throw err;
            }
          }
        }

        const parsed = readStoredImport(key);
        if (parsed) {
          try {
            const localized = await prefetchImportAssets(parsed as any, controller.signal);
            if (controller.signal.aborted || cancelled) return;
            setProject(localized as any);
          } catch (err: any) {
            setError(err?.message || "Failed to download cached clips");
            throw err;
          }
        }
      } catch (err) {
        console.warn("[useGenerateEditImport] Failed to load import", err);
        setError(err?.message || "Failed to load generate edit import");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadImport();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [paramName]);

  return useMemo(
    () => ({
      project,
      loading,
      error,
    }),
    [project, loading, error]
  );
}

