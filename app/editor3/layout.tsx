import React from "react";
import type { Metadata } from "next";

import "./editor-globals.css";
import styles from "./editor2-layout.module.css";

export const metadata: Metadata = {
  title: "Attention Engine Demo — Editor 3",
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
