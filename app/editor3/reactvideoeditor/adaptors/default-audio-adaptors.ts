import { SoundOverlayAdaptor } from "../types/overlay-adaptors";
import { StandardAudio } from "../types/media-adaptors";

const PUBLIC_SONG_FILES = [
  "bingbingbing.mp3",
  "cinemaedit.mp3",
  "Double_Take.mp3",
  "editor-sample-fashionkilla.mp3",
  "electric.mp3",
  "electricDemo2.MP3",
  "Factory.mp3",
  "FashionKilla.mp3",
  "LoveMe.mp3",
  "LoveMeAudio.mp3",
  "pieceofheaven.mp3",
  "slowmospanish.mp3",
  "test.mp3",
  "TouchTheSky.mp3",
  "UpToSomething.mp3",
  "Way_Down_We_Go.mp3",
] as const;

const normaliseTitle = (file: string) =>
  file.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");

// Static list of audio tracks available from /public/songs
export const publicSongTracks: StandardAudio[] = PUBLIC_SONG_FILES.map(
  (file) => ({
    id: file,
    title: normaliseTitle(file),
    artist: "Local Library",
    duration: 30, // fallback; actual duration resolved at runtime
    file: `/songs/${file}`,
  })
);

/**
 * Creates a static audio adaptor from a list of audio tracks
 * Useful for providing predefined audio collections
 */
export const createStaticAudioAdaptor = (
  audioList: StandardAudio[],
  displayName: string = "Stock Audio"
): SoundOverlayAdaptor => ({
  name: "static-audio",
  displayName,
  description: "Static collection of audio tracks",
  requiresAuth: false,
  
  search: async (params) => {
    // Filter the static list based on search query (if provided)
    let filtered = audioList;
    
    if (params.query && params.query.trim()) {
      const query = params.query.toLowerCase();
      filtered = audioList.filter(audio => 
        audio.title.toLowerCase().includes(query) ||
        audio.artist.toLowerCase().includes(query)
      );
    }
    
    // Handle pagination
    const page = params.page || 1;
    const perPage = params.perPage || 50;
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    const paginatedItems = filtered.slice(startIndex, endIndex);
    
    return {
      items: paginatedItems,
      totalCount: filtered.length,
      hasMore: endIndex < filtered.length
    };
  },
  
  getAudioUrl: (audio) => audio.file
});

/**
 * Default audio adaptor with stock audio tracks
 * Automatically included when no audio adaptors are configured
 */
export const defaultAudioAdaptor = createStaticAudioAdaptor(
  publicSongTracks,
  "Public Songs"
);

/**
 * Helper function to get default audio adaptors
 * This provides a consistent way to include default audio content
 */
export const getDefaultAudioAdaptors = (): SoundOverlayAdaptor[] => {
  return [defaultAudioAdaptor];
}; 