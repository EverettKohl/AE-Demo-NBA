"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import ImmersiveIntro from "@/components/ImmersiveIntro";
import "./editor3/editor-globals.css";
import styles from "./editor3/editor2-layout.module.css";

const ReactVideoEditorClient = dynamic(
  () => import("./editor3/react-video-editor-client").then((m) => m.ReactVideoEditorClient),
  {
    ssr: false,
  }
);

export default function EditorLandingPage() {
  const [showIntro, setShowIntro] = useState(true);

  return (
    <div className={styles.shell}>
      <div className="relative min-h-screen bg-black">
        {showIntro && <ImmersiveIntro isOverlay onDismiss={() => setShowIntro(false)} />}
        <ReactVideoEditorClient />
      </div>
    </div>
  );
}
