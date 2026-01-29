/**
 * Minimal placeholder pre-cached clip map (v1).
 */
export const PRE_CACHED_CLIPS = {};

export const findBestPreCachedClip = (videoId) => {
  const clips = PRE_CACHED_CLIPS[videoId] || [];
  return clips.length ? clips[0] : null;
};

export const getPreCachedClipUrl = (clip, cloudName) => {
  if (!clip || !cloudName) return null;
  return `https://res.cloudinary.com/${cloudName}/video/upload/${clip.publicId || clip.id || ""}.mp4`;
};

export default { PRE_CACHED_CLIPS, findBestPreCachedClip, getPreCachedClipUrl };

