import React from "react";
import type { Metadata } from "next";

import "../editor3/editor-globals.css";
import styles from "../editor3/editor2-layout.module.css";

const FAVICON = "/favicon.ico";

export const metadata: Metadata = {
  title: "Attention Engine Demo — Editor",
  description: "Attention Engine Demo",
  icons: {
    icon: [{ url: FAVICON, type: "image/x-icon" }],
    shortcut: [{ url: FAVICON, type: "image/x-icon" }],
    apple: [{ url: FAVICON, type: "image/x-icon" }],
  },
};

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.shell}>{children}</div>;
}
