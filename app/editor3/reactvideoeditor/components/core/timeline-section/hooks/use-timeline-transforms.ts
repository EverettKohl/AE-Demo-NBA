import React from 'react';
import { Overlay, OverlayType } from '../../../../types';
import { TimelineTrack, TimelineItem } from '../../../advanced-timeline/types';
import { frameToTime, timeToFrame } from '../../../../utils/time';
import { TIMELINE_GRACE_SECONDS } from '../../../../../constants';

/**
 * Hook to handle data transformation between overlays and timeline tracks.
 * All frame/second conversions use the provided fps to stay in sync with the player.
 */
export const useTimelineTransforms = (fps: number) => {
  const GRACE_SECONDS = TIMELINE_GRACE_SECONDS;
  /**
   * Transform overlays to timeline tracks format
   */
  const transformOverlaysToTracks = React.useCallback((overlays: Overlay[]): TimelineTrack[] => {
    // Group overlays by row
    const rowMap = new Map<number, Overlay[]>();
    
    overlays.forEach(overlay => {
      const row = overlay.row || 0;
      if (!rowMap.has(row)) {
        rowMap.set(row, []);
      }
      rowMap.get(row)!.push(overlay);
    });

    // Convert to timeline tracks
    const tracks: TimelineTrack[] = [];
    
    // Ensure we have at least one track
    const maxRow = Math.max(0, ...Array.from(rowMap.keys()));
    
    for (let i = 0; i <= maxRow; i++) {
      const overlaysInRow = rowMap.get(i) || [];
      const isTrackMuted = overlaysInRow.some((overlay) => (overlay as any).trackMuted);
      
      const mediaItems: TimelineItem[] = [];

      overlaysInRow.forEach(overlay => {
        const originalStartSeconds = frameToTime(overlay.from, fps);
        const originalEndSeconds = frameToTime(overlay.from + overlay.durationInFrames, fps);
        const leadShift = originalStartSeconds < GRACE_SECONDS ? GRACE_SECONDS - originalStartSeconds : 0;
        const startSeconds = originalStartSeconds + leadShift;
        const endSeconds = originalEndSeconds + leadShift;

        const baseItem = {
          id: overlay.id.toString(),
          trackId: `track-${i}`,
          start: startSeconds,
          end: endSeconds,
          label: getOverlayLabel(overlay),
          type: mapOverlayTypeToTimelineType(overlay.type),
          color: getOverlayColor(overlay.type),
          data: overlay, // Store the original overlay data
        };

        // Add media timing properties for video overlays
        if (overlay.type === OverlayType.VIDEO) {
          const videoOverlay = overlay as any;
          const videoStartTimeSeconds = typeof videoOverlay.videoStartTime === 'number' ? videoOverlay.videoStartTime : 0;
          
          const videoItem: TimelineItem = {
            ...baseItem,
            mediaStart: videoStartTimeSeconds,
            ...(videoOverlay.mediaSrcDuration && { 
              mediaSrcDuration: videoOverlay.mediaSrcDuration,
              mediaEnd: videoStartTimeSeconds + frameToTime(overlay.durationInFrames, fps)
            }),
          };
          
          mediaItems.push(videoItem);
          return;
        }

        // Add media timing properties for audio overlays  
        if (overlay.type === OverlayType.SOUND) {
          const audioOverlay = overlay as any;
          // startFromSound is stored in frames, so convert to seconds for mediaStart
          const audioStartTimeSeconds = typeof audioOverlay.startFromSound === 'number' ? frameToTime(audioOverlay.startFromSound, fps) : 0;
          
          mediaItems.push({
            ...baseItem,
            mediaStart: audioStartTimeSeconds,
            mediaEnd: audioStartTimeSeconds + frameToTime(overlay.durationInFrames, fps),
            ...(audioOverlay.mediaSrcDuration && { mediaSrcDuration: audioOverlay.mediaSrcDuration }),
          });
          return;
        }

        // Return base item for other overlay types
        mediaItems.push(baseItem);
      });

      const graceBlock: TimelineItem = {
        id: `grace-${i}`,
        trackId: `track-${i}`,
        start: 0,
        end: GRACE_SECONDS,
        label: "Lead-in",
        type: "grace-block",
        color: "#1f2937",
        data: { isGraceBlock: true },
      };

      tracks.push({
        id: `track-${i}`,
        name: `Track ${i + 1}`,
        items: [graceBlock, ...mediaItems],
        magnetic: false,
        visible: true,
        muted: isTrackMuted,
      });
    }

    // If no tracks exist, create one empty track
    if (tracks.length === 0) {
      tracks.push({
        id: 'track-0',
        name: 'Track 1',
        items: [],
        magnetic: false,
        visible: true,
        muted: false,
      });
    }

    return tracks;
  }, []);

  /**
   * Transform timeline tracks back to overlays
   */
  const transformTracksToOverlays = React.useCallback((tracks: TimelineTrack[]): Overlay[] => {    
    const overlays: Overlay[] = [];
    
    let mediaRow = 0;
    tracks.forEach((track) => {
      // Skip poster tracks for overlay conversion and row counting
      if (track.id.endsWith('-posters')) {
        return;
      }

      track.items.forEach(item => {
        if ((item as any)?.data?.isGraceBlock) {
          return;
        }
        if ((item as any)?.data?.isPoster) {
          // Skip synthetic poster items when converting back to overlays
          return;
        }
        if (item.data && typeof item.data === 'object') {
          // Use the original overlay data if available
          const originalOverlay = item.data as Overlay;
          const effectiveStart = Math.max(GRACE_SECONDS, item.start);
          const durationSeconds = Math.max(0, item.end - item.start);
          const effectiveEnd = Math.max(effectiveStart + durationSeconds, item.end);
          
          const updatedOverlay: Overlay = {
            ...originalOverlay,
            from: timeToFrame(effectiveStart, fps), // Convert seconds to frames
            durationInFrames: timeToFrame(effectiveEnd - effectiveStart, fps),
            row: mediaRow,
          };
          
          // Preserve track mute state on overlays so it survives round trips
          const updatedOverlayWithTrackMute = {
            ...updatedOverlay,
            trackMuted: track.muted ?? false,
          } as Overlay & { trackMuted?: boolean };
        

          // Update media timing properties based on timeline item's mediaStart
          if (originalOverlay.type === OverlayType.VIDEO && item.mediaStart !== undefined) {
            // Keep mediaStart in seconds for videoStartTime (video-layer-content.tsx expects seconds)
            (updatedOverlay as any).videoStartTime = item.mediaStart;
          } else if (originalOverlay.type === OverlayType.SOUND && item.mediaStart !== undefined) {
            // Convert mediaStart from seconds back to frames for startFromSound
            (updatedOverlay as any).startFromSound = timeToFrame(item.mediaStart, fps);
          }

          overlays.push(updatedOverlayWithTrackMute);
        }
      });

      mediaRow += 1;
    });
   
    return overlays;
  }, []);

  return {
    transformOverlaysToTracks,
    transformTracksToOverlays,
  };
};

/**
 * Get display label for overlay
 */
const getOverlayLabel = (overlay: Overlay): string => {
  // Try to get content from overlay
  let content = '';
  if ('content' in overlay && overlay.content) {
    content = overlay.content;
  }
  
  switch (overlay.type) {
    case OverlayType.TEXT:
      return content || 'Text';
    case OverlayType.IMAGE:
      return content || 'Image';
    case OverlayType.VIDEO:
      return content || 'Video';
    case OverlayType.SOUND:
      return content || 'Audio';
    case OverlayType.CAPTION:
      return 'Caption';
    case OverlayType.STICKER:
      return content || 'Sticker';
    case OverlayType.SHAPE:
      return content || 'Shape';
    default:
      return 'Item';
  }
};

/**
 * Map overlay type to timeline item type
 */
const mapOverlayTypeToTimelineType = (type: OverlayType): string => {
  switch (type) {
    case OverlayType.TEXT:
      return 'text';
    case OverlayType.IMAGE:
      return 'image';
    case OverlayType.VIDEO:
      return 'video';
    case OverlayType.SOUND:
      return 'audio';
    case OverlayType.CAPTION:
      return 'caption';
    case OverlayType.STICKER:
      return 'sticker';
    case OverlayType.SHAPE:
      return 'shape';
    default:
      return 'unknown';
  }
};

/**
 * Get color for overlay type
 */
const getOverlayColor = (type: OverlayType): string => {
  switch (type) {
    case OverlayType.TEXT:
      return '#3b82f6'; // blue
    case OverlayType.IMAGE:
      return '#10b981'; // green
    case OverlayType.VIDEO:
      return '#8b5cf6'; // purple
    case OverlayType.SOUND:
      return '#f59e0b'; // amber
    case OverlayType.CAPTION:
      return '#ef4444'; // red
    case OverlayType.STICKER:
      return '#ec4899'; // pink
    case OverlayType.SHAPE:
      return '#6b7280'; // gray
    default:
      return '#9ca3af'; // gray
  }
};