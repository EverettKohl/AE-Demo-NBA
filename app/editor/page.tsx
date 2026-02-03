"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import ImmersiveIntro from "@/components/ImmersiveIntro";

const ReactVideoEditorClient = dynamic(
  () => import("../editor3/react-video-editor-client").then((m) => m.ReactVideoEditorClient),
  {
    ssr: false,
  }
);

export default function EditorPage() {
  const [showIntro, setShowIntro] = useState(true);

  return (
    <div className="relative min-h-screen bg-black">
      {showIntro && <ImmersiveIntro isOverlay onDismiss={() => setShowIntro(false)} />}
      <ReactVideoEditorClient />
    </div>
  );
}
