"use client";

import React, { createContext, useContext, useEffect } from "react";

const ThemeContext = createContext({ theme: "dark" });

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    try {
      localStorage.setItem("theme", "dark");
    } catch (err) {
      // ignore storage failures
    }
  }, []);

  return <ThemeContext.Provider value={{ theme: "dark" }}>{children}</ThemeContext.Provider>;
}
