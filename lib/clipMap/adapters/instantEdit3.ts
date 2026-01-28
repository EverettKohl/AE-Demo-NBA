import type { ClipMap } from "../types";
import { fromQuickEdit3Plan } from "./quickEdit3";

/**
 * Instant Edit 3 currently returns a `plan` that is structurally identical to Quick Edit 3
 * (built via `buildQuickEdit3Plan`). We reuse the same adapter.
 */
export const fromInstantEdit3Response = (payload: any): ClipMap => {
  return fromQuickEdit3Plan(payload?.plan || payload);
};

