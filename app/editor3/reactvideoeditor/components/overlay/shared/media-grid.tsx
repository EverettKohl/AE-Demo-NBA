import { useRef, useState } from "react";
import { MediaLoadingGrid } from "./media-loading-grid";
import { MediaEmptyState } from "./media-empty-state";
import { setCurrentNewItemDragData, setCurrentNewItemDragType } from "../../advanced-timeline/hooks/use-new-item-drag";


interface MediaItem {
  id: string | number;
  _source: string;
  _sourceDisplayName: string;
  thumbnail?: string;
  src?: any; // For images
}

interface MediaGridProps<T extends MediaItem> {
  items: T[];
  isLoading: boolean;
  isDurationLoading?: boolean;
  loadingItemKey?: string | null;
  hasAdaptors: boolean;
  hasSearched: boolean;
  activeTab: string;
  sourceResults: Array<{
    adaptorName: string;
    adaptorDisplayName: string;
    itemCount: number;
    hasMore: boolean;
    error?: string;
  }>;
  mediaType: string; // e.g., "videos", "images"
  onItemClick: (item: T) => void;
  getThumbnailUrl: (item: T) => string;
  getItemKey: (item: T) => string;
  showSourceBadge?: boolean;
  enableTimelineDrag?: boolean; // Enable dragging to timeline
  onEditClick?: (item: T) => void; // Optional edit handler
}

/**
 * MediaGrid - Shared media grid component
 * 
 * Provides consistent masonry grid layout and state handling across all media panels.
 * Handles loading states, empty states, and media item display with hover effects.
 * 
 * New: Supports dragging items to timeline with ghost element preview
 */
export const MediaGrid = <T extends MediaItem>({
  items,
  isLoading,
  isDurationLoading = false,
  loadingItemKey = null,
  hasAdaptors,
  hasSearched,
  activeTab,
  sourceResults,
  mediaType,
  onItemClick,
  getThumbnailUrl,
  getItemKey,
  enableTimelineDrag = false,
  onEditClick,
}: MediaGridProps<T>) => {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Get active tab display name for empty state
  const activeTabDisplayName = sourceResults.find(
    s => s.adaptorName === activeTab
  )?.adaptorDisplayName;

  if (isLoading) {
    return <MediaLoadingGrid />;
  }

  // Handle drag start for timeline integration
  const handleDragStart = (item: T) => (e: React.DragEvent) => {
    if (!enableTimelineDrag) return;
    
    // Extract duration from item if available (videos may have duration metadata)
    const itemDuration = (item as any).duration;
    const defaultDuration = mediaType === "videos" ? 5 : 5; // Default to 5 seconds
    const duration = typeof itemDuration === 'number' && itemDuration > 0 
      ? itemDuration 
      : defaultDuration;
    
    // Set drag data for timeline
    const dragData = {
      isNewItem: true,
      type: mediaType === "videos" ? "video" : "image",
      label: item._sourceDisplayName,
      duration, // Use actual duration from video metadata or default
      data: item, // Full item data
    };
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData("application/json", JSON.stringify(dragData));
    
    // Set global drag state for timeline
    setCurrentNewItemDragType(dragData.type);
    setCurrentNewItemDragData(dragData);
    
    // Create a custom drag image (smaller thumbnail)
    const thumbnail = e.currentTarget.querySelector('img');
    if (thumbnail) {
      // Create a smaller version of the thumbnail for dragging
      const dragPreview = document.createElement('div');
      dragPreview.style.position = 'absolute';
      dragPreview.style.top = '-9999px';
      dragPreview.style.width = '60px';
      dragPreview.style.height = '40px';
      dragPreview.style.overflow = 'hidden';
      dragPreview.style.borderRadius = '4px';
      dragPreview.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
      dragPreview.style.cursor = 'none';
      
      const clonedImg = thumbnail.cloneNode(true) as HTMLImageElement;
      clonedImg.style.width = '80px';
      clonedImg.style.height = '60px';
      clonedImg.style.objectFit = 'cover';
      
      dragPreview.appendChild(clonedImg);
      document.body.appendChild(dragPreview);
      
      e.dataTransfer.setDragImage(dragPreview, 40, 30);
      
      // Clean up the preview element after drag starts
      setTimeout(() => {
        dragPreview.remove();
      }, 0);
    }
  };
  
  const handleDragEnd = () => {
    if (!enableTimelineDrag) return;
    
    // Clear drag state
    setCurrentNewItemDragType(null);
    setCurrentNewItemDragData(null);
  };

  if (items.length > 0) {
    return (
      <div className="columns-1 sm:columns-1 gap-3 space-y-3">
        {items.map((item) => {
          const itemKey = getItemKey(item);
          const isItemLoading = isDurationLoading && loadingItemKey === itemKey;
          
          const isPlaying = playingKey === itemKey;
          const videoUrl = (item as any).videoFiles?.[0]?.url || getThumbnailUrl(item);
          const paddingBottom = (() => {
            const w = Number((item as any)?.width) || 16;
            const h = Number((item as any)?.height) || 9;
            const ratio = h && w ? (h / w) * 100 : 56.25;
            return `${ratio}%`;
          })();
          const explicitDuration = Number((item as any)?.duration);
          const durationFromState = durations[itemKey];
          const durationSec = Number.isFinite(explicitDuration) && explicitDuration > 0
            ? explicitDuration
            : (Number.isFinite(durationFromState) && durationFromState > 0 ? durationFromState : 1);
          const played = progress[itemKey] ?? 0;
          const progressPct = Math.min(100, Math.max(0, (played / durationSec) * 100));

          return (
            <div
              key={itemKey}
              role="group"
              tabIndex={-1}
              aria-disabled={isItemLoading}
              className="relative block w-full border border-border/40 bg-black/30 rounded-md overflow-hidden break-inside-avoid mb-3"
              draggable={enableTimelineDrag && !isItemLoading}
              onDragStart={handleDragStart(item)}
              onDragEnd={handleDragEnd}
            >
              <div className="relative w-full">
                {/* Aspect-ratio container based on media dimensions */}
                <div className="relative w-full" style={{ paddingBottom }}>
                  {isPlaying ? (
                    <video
                      key={`${itemKey}-video`}
                      className="absolute inset-0 w-full h-full rounded-sm object-cover"
                      src={videoUrl}
                      poster={getThumbnailUrl(item)}
                      controls={false}
                      autoPlay
                      muted
                      loop
                      playsInline
                      controlsList="nodownload noremoteplayback nofullscreen"
                      ref={(el) => {
                        videoRefs.current[itemKey] = el;
                      }}
                      onTimeUpdate={(e) => {
                        const current = (e.target as HTMLVideoElement).currentTime;
                        setProgress((prev) => ({ ...prev, [itemKey]: current }));
                      }}
                      onLoadedMetadata={(e) => {
                        const d = (e.target as HTMLVideoElement).duration;
                        if (Number.isFinite(d) && !(item as any)?.duration) {
                          setDurations((prev) => ({ ...prev, [itemKey]: d }));
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    />
                  ) : (
                    <img
                      src={getThumbnailUrl(item)}
                      alt={`${mediaType.slice(0, -1)} from ${item._sourceDisplayName}`}
                      className={`absolute inset-0 w-full h-full rounded-sm object-cover  ${
                        isItemLoading ? 'opacity-50' : 'hover:opacity-60'
                      }`}
                      draggable={false}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlayingKey(itemKey);
                      }}
                    />
                  )}
                  {/* Loading overlay for individual item */}
                  {isItemLoading && (
                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-secondary border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {!isItemLoading && (
                    <div className="absolute inset-0 bg-black/25 opacity-0 hover:opacity-100 transition-opacity duration-200" />
                  )}

                  {/* Controls overlay */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <button
                      type="button"
                      className="h-10 w-10 rounded-full bg-black/45 border border-white/10 text-white flex items-center justify-center shadow-md backdrop-blur-[2px] pointer-events-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlayingKey(isPlaying ? null : itemKey);
                      }}
                    >
                      {isPlaying ? (
                        <svg
                          aria-label="Pause"
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="text-white"
                        >
                          <rect x="3" y="2.5" width="3" height="9" rx="0.6" fill="currentColor" />
                          <rect x="8" y="2.5" width="3" height="9" rx="0.6" fill="currentColor" />
                        </svg>
                      ) : (
                        <svg
                          aria-label="Play"
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="text-white translate-x-px"
                        >
                          <path
                            d="M4 2.75L11 7L4 11.25V2.75Z"
                            fill="currentColor"
                          />
                        </svg>
                      )}
                    </button>
                  </div>

                  {/* Duration and progress */}
                  <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 pointer-events-none">
                    <div className="flex items-center justify-end text-[11px] text-white/90 drop-shadow-sm mb-1">
                      <span>{Math.round(durations[itemKey] ?? durationSec)}s</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/25 overflow-hidden">
                      <div
                        className="h-full bg-white/85 rounded-full transition-all duration-150"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute top-2 right-2 flex gap-2 pointer-events-auto">
                {onEditClick && (
                  <button
                    type="button"
                    className="px-2.5 py-1.5 rounded-full text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500/60 shadow-sm"
                    disabled={isItemLoading}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditClick(item);
                    }}
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="px-2.5 py-1.5 rounded-full text-[11px] bg-primary/90 hover:bg-primary text-primary-foreground border border-primary/60 shadow-sm"
                  disabled={isItemLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    onItemClick(item);
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Determine empty state type
  if (!hasAdaptors)
    return <MediaEmptyState type="no-adaptors" mediaType={mediaType} />;

  if (hasSearched && sourceResults.length > 0) {
    return (
      <MediaEmptyState 
        type="no-results" 
        mediaType={mediaType}
        activeTabName={activeTab !== "all" ? activeTabDisplayName : undefined}
      />
    );
  }

  return <MediaEmptyState type="initial" mediaType={mediaType} />;
}; 