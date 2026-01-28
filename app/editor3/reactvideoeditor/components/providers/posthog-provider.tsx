"use client";

import React from "react";

/**
 * PostHog is disabled here to prevent runtime module issues in the editor2 page.
 * If analytics are needed later, re-enable with a guarded dynamic import.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}