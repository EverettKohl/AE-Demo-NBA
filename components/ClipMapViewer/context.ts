import * as React from "react";

export type ClipMapViewerContextValue = {
  activeSlotId: string | null;
  setActiveSlotId: (id: string | null) => void;
};

export const ClipMapViewerContext = React.createContext<ClipMapViewerContextValue | null>(null);

export const useClipMapViewerContext = () => {
  const ctx = React.useContext(ClipMapViewerContext);
  if (!ctx) {
    throw new Error("useClipMapViewerContext must be used within ClipMapViewerContext.Provider");
  }
  return ctx;
};

