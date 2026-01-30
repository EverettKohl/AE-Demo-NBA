import { useEffect, useState } from "react";
import { getDownloadUsage } from "./clipDownloadManager";

export const useDownloadStorage = (refreshMs: number = 1000) => {
  const [usage, setUsage] = useState(() => getDownloadUsage());

  useEffect(() => {
    const tick = () => setUsage(getDownloadUsage());
    const id = window.setInterval(tick, Math.max(250, refreshMs));
    return () => window.clearInterval(id);
  }, [refreshMs]);

  return usage;
};
