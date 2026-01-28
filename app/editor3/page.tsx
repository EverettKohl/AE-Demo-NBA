import dynamic from "next/dynamic";

const ReactVideoEditorClient = dynamic(() => import("./react-video-editor-client").then((m) => m.ReactVideoEditorClient), {
  ssr: false,
});

export default function EditorPage() {
  return <ReactVideoEditorClient />;
}
