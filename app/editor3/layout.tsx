import React from "react";
import type { Metadata } from "next";

import "./editor-globals.css";
import styles from "./editor2-layout.module.css";

export const metadata: Metadata = {
  title: "Attention Engine Demo — Editor 3",
  description: "Editor 3 experience for the Attention Engine demo.",
};

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.shell}>{children}</div>;
}
