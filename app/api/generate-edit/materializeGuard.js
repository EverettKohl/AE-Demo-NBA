export const isMaterializeAllowed = (env = process.env) => {
  const enableFlag = env.GE_ENABLE_MATERIALIZE === "true";
  const isServerlessProd = Boolean(env.VERCEL) || env.NODE_ENV === "production";
  if (enableFlag) return true;
  // Default: allow only on non-prod self-host (no Vercel) to keep /tmp usable.
  return !isServerlessProd;
};

export default isMaterializeAllowed;
