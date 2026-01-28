"use client";

import React, { createContext, useContext, useEffect } from "react";

const ThemeContext = createContext({ theme: "dark" });

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeProvider2({ children }) {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    try {
      localStorage.setItem("theme", "dark");
    } catch {
      // ignore storage errors
    }
  }, []);

  return <ThemeContext.Provider value={{ theme: "dark" }}>{children}</ThemeContext.Provider>;
}
