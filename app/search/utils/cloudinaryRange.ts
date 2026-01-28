import { roundSeconds, validateClipRange } from "./time";

export type CloudinaryRangeInput = {
  cloudName?: string | null;
  publicId?: string | null;
  start: number;
  end: number;
  maxDuration?: number;
};

const sanitizePublicId = (publicId?: string | null) => {
  if (!publicId) return null;
  // Strip file extension and leading slashes
  return publicId.replace(/^\//, "").replace(/\.mp4$/i, "");
};

export const buildCloudinaryRangeUrl = ({
  cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  publicId,
  start,
  end,
  maxDuration = 180,
}: CloudinaryRangeInput): string | null => {
  const validation = validateClipRange(start, end, { maxDuration });
  if (!validation.ok) return null;

  const cleanCloud = cloudName?.trim();
  const cleanId = sanitizePublicId(publicId);
  if (!cleanCloud || !cleanId) return null;

  const startRounded = roundSeconds(start);
  const endRounded = roundSeconds(end);
  return `https://res.cloudinary.com/${cleanCloud}/video/upload/so_${startRounded},eo_${endRounded},f_mp4/${cleanId}.mp4`;
};

