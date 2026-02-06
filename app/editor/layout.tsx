import React from "react";
import type { Metadata } from "next";

import "../editor3/editor-globals.css";
import styles from "../editor3/editor2-layout.module.css";

const FAVICON = "/favicon.ico";
const SITE_NAME = "FanEdit.com";
const SITE_DESCRIPTION = "FanEdit.com is the AI-powered fan edit creation platform that turns long-form footage into social-ready clips automatically.";
const SOCIAL_IMAGE = "/faneditMedia.png";

export const metadata: Metadata = {
  title: `${SITE_NAME} — Editor`,
  description: SITE_DESCRIPTION,
  icons: {
    icon: [{ url: FAVICON, type: "image/x-icon" }],
    shortcut: [{ url: FAVICON, type: "image/x-icon" }],
    apple: [{ url: FAVICON, type: "image/x-icon" }],
  },
  openGraph: {
    title: `${SITE_NAME} — Editor`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: SOCIAL_IMAGE,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} social preview`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Editor`,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.shell}>{children}</div>;
}
