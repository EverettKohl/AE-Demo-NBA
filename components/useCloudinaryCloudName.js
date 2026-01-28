"use client";

import { useCallback, useState } from "react";

/**
 * Fetches and caches the Cloudinary cloud name for client components.
 * Falls back to NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME when the API is unavailable.
 */
const useCloudinaryCloudName = () => {
  const [cloudName, setCloudName] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getCloudinaryCloudName = useCallback(async () => {
    if (cloudName) {
      return cloudName;
    }

    if (loading) {
      // If a request is already in-flight, wait briefly until the state updates.
      return new Promise((resolve) => {
        setTimeout(() => resolve(cloudName), 100);
      });
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/cloudinary-config");
      if (response.ok) {
        const payload = await response.json();
        if (payload?.cloudName) {
          setCloudName(payload.cloudName);
          return payload.cloudName;
        }
      }

      const fallback = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || null;
      if (fallback) {
        setCloudName(fallback);
        return fallback;
      }

      throw new Error("Cloudinary configuration unavailable");
    } catch (err) {
      setError(err.message || "Failed to load Cloudinary config");
      return null;
    } finally {
      setLoading(false);
    }
  }, [cloudName, loading]);

  return {
    cloudName,
    loading,
    error,
    getCloudinaryCloudName,
  };
};

export default useCloudinaryCloudName;


