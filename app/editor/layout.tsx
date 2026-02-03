import React from "react";
import type { Metadata } from "next";

import "../editor3/editor-globals.css";
import styles from "../editor3/editor2-layout.module.css";

export const metadata: Metadata = {
  title: "Attention Engine Demo — Editor",
  description: "Attention Engine Demo",
  icons: {
    icon: "/AELogoicon.png",
    shortcut: "/AELogoicon.png",
    apple: "/AELogoicon.png",
  },
};

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.shell}>{children}</div>;
}
