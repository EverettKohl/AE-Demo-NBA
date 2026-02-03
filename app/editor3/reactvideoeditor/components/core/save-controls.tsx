"use client";

import React from "react";
import { Save } from "lucide-react";
import { usePathname } from "next/navigation";

import { Overlay, OverlayType } from "@editor/reactvideoeditor/types";

import { useEditorContext } from "../../contexts/editor-context";
import { Button } from "../ui/button";

interface SaveControlsProps {
  /**
   * Function to save the project
   */
  onSave?: () => Promise<void>;
  /**
   * Whether the save operation is in progress
   */
  isSaving?: boolean;
}

/**
 * SaveControls component provides a save button for the project
 */
export const SaveControls: React.FC<SaveControlsProps> = ({
  onSave,
  isSaving = false,
}) => {
  const pathname = usePathname();
  const isFormatEditor = pathname?.startsWith("/format-editor");
  const {
    overlays,
    aspectRatio,
    backgroundColor,
    durationInFrames,
    playbackRate,
    currentFrame,
    selectedOverlayId,
    selectedOverlayIds,
    trackHeight,
    timelineItemHeight,
    zoomConstraints,
    snappingConfig,
    enablePushOnDrag,
    initialRows,
    maxRows,
    fps,
    renderType,
    videoWidth,
    videoHeight,
  } = useEditorContext();

  const [isSavingFormat, setIsSavingFormat] = React.useState(false);

  const normalizeSlug = (value?: string | null) => {
    if (!value) return "";
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  };

const hashToColor = (input: string | number) => {
  const str = input?.toString() || "0";
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // convert to 32bit int
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 62%)`;
};

const makeMediaPlaceholder = (overlay: Overlay): Overlay => {
  const color =
    (overlay as any)?.placeholder?.color ||
    hashToColor((overlay as any)?.id ?? (overlay as any)?.content ?? Math.random());
  return {
    ...overlay,
    type: OverlayType.IMAGE, // force image rendering only
    placeholder: { kind: "media", color },
    placeholderOriginalType: (overlay as any)?.placeholderOriginalType || overlay.type,
    src: undefined,
    content: `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'><rect width='2' height='2' fill='${color}'/></svg>`
    )}`,
    styles: {
      ...(overlay as any)?.styles,
      backgroundColor: (overlay as any)?.styles?.backgroundColor || color,
      objectFit: (overlay as any)?.styles?.objectFit || "cover",
    },
    meta: undefined,
  };
};

const sanitizeOverlaysForFormat = (items: Overlay[]) =>
  items.map((ov) => {
    if (!ov) return ov;
    const placeholderKind = (ov as any)?.placeholder?.kind;
    const wasMedia =
      ov.type === OverlayType.VIDEO ||
      ov.type === OverlayType.IMAGE ||
      placeholderKind === "video" ||
      placeholderKind === "media" ||
      (ov as any)?.placeholderOriginalType === "video" ||
      (ov as any)?.placeholderOriginalType === "image";
    if (!wasMedia) return ov;
    return makeMediaPlaceholder(ov);
  });

  const handleSaveFormat = async () => {
    if (!isFormatEditor) return;
    const defaultSlug = `format-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const input =
      typeof window !== "undefined"
        ? window.prompt("File name for this format (no extension needed)", defaultSlug)
        : null;

    if (input === null) return;

    const slug = normalizeSlug(input || defaultSlug) || defaultSlug;
    const projectId =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("projectId") || "FormatEditorProject"
        : "FormatEditorProject";

    const sanitizedOverlays = sanitizeOverlaysForFormat(overlays);

    const snapshot = {
      meta: {
        projectId,
        savedAt: new Date().toISOString(),
        fps,
        renderType,
        source: "format-editor",
      },
      timeline: {
        overlays: sanitizedOverlays,
        aspectRatio,
        backgroundColor,
        durationInFrames,
        playbackRate,
        currentFrame,
        selectedOverlayId,
        selectedOverlayIds,
        trackHeight,
        timelineItemHeight,
        zoomConstraints,
        snappingConfig,
        initialRows,
        maxRows,
        enablePushOnDrag,
        videoWidth,
        videoHeight,
      },
    };

    // Strip out any non-serializable values before sending to the API.
    const payload = JSON.parse(JSON.stringify(snapshot));

    setIsSavingFormat(true);
    try {
      const res = await fetch("/api/format-editor2/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, payload }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Save failed");
      }

      const data = await res.json();
      if (typeof window !== "undefined") {
        window.alert(`Saved format to ${data?.path || data?.filename || `${slug}.json`}`);
      }
    } catch (error) {
      console.error("Failed to save format", error);
      if (typeof window !== "undefined") {
        window.alert("Unable to save format. Please try again.");
      }
    } finally {
      setIsSavingFormat(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="relative hover:bg-accent text-foreground"
        onClick={onSave}
        disabled={isSaving || isSavingFormat}
      >
        <Save className="w-3.5 h-3.5" />
      </Button>

      <Button
        variant="secondary"
        size="sm"
        className="relative cursor-not-allowed text-muted-foreground opacity-80"
        disabled
        aria-label="Export is disabled in demo"
      >
        Export Disabled In Demo
      </Button>

      {isFormatEditor && (
        <Button
          variant="secondary"
          size="sm"
          className="font-light"
          onClick={handleSaveFormat}
          disabled={isSaving || isSavingFormat}
        >
          {isSavingFormat ? "Saving..." : "Save format"}
        </Button>
      )}
    </div>
  );
};