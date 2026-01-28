"use client";

import React from "react";

import { SHOW_MOBILE_WARNING } from "@editor/constants";
import { createPexelsImageAdaptor } from "@editor/reactvideoeditor/adaptors/pexels-image-adaptor";
import { ReactVideoEditor } from "@editor/reactvideoeditor/components/react-video-editor";
import { ProjectLoadConfirmModal } from "@editor/reactvideoeditor/components/shared/project-load-confirm-modal";
import { MobileWarningModal } from "@editor/reactvideoeditor/components/shared/mobile-warning-modal";
import { PostHogProvider } from "@editor/reactvideoeditor/components/providers/posthog-provider";
import { Toaster } from "@editor/reactvideoeditor/components/ui/toaster";
import { CustomTheme } from "@editor/reactvideoeditor/hooks/use-extended-theme-switcher";
import { useProjectStateFromUrl } from "@editor/reactvideoeditor/hooks/use-project-state-from-url";
import { HttpRenderer } from "@editor/reactvideoeditor/utils/http-renderer";
import { useGenerateEditImport } from "./useGenerateEditImport";
import { useQuickEdit6Import } from "./useQuickEdit6Import";
import { Editor2Sidebar } from "./editor2-sidebar";
import { twelveLabsVideoAdaptor } from "./twelve-labs-video-adaptor";
import styles from "./editor2-layout.module.css";

const PROJECT_ID = "TestComponent";
const SIDEBAR_ICON_WIDTH = "3.6rem";
const SIDEBAR_PANEL_WIDTH = 288; // px

export function ReactVideoEditorClient() {
  const { project: geImport, loading: loadingGe } = useGenerateEditImport();
  const { project: qe6Import, loading: loadingQe6 } = useQuickEdit6Import();

  // Derive the project id before passing into hooks to avoid TDZ issues.
  const projectIdForAutosave = React.useMemo(() => {
    const activeImport = geImport || qe6Import;
    if (!activeImport?.meta) return PROJECT_ID;
    if (activeImport.meta.projectId) return activeImport.meta.projectId as string;
    if (activeImport.meta.jobId) return `import-${activeImport.meta.jobId}`;
    return PROJECT_ID;
  }, [geImport, qe6Import]);

  const {
    overlays,
    aspectRatio,
    backgroundColor,
    isLoading,
    showModal,
    onConfirmLoad,
    onCancelLoad,
  } = useProjectStateFromUrl("projectId", projectIdForAutosave);

  const activeImport = geImport || qe6Import;
  const disableAutosave = Boolean(activeImport);

  // If an import is present, prefer it over any fallback/project load.
  const useImport = Boolean(activeImport);
  const resolvedOverlays = React.useMemo(
    () => (useImport ? (activeImport?.overlays as any) : overlays),
    [useImport, activeImport, overlays]
  );
  const resolvedAspectRatio = React.useMemo(
    () => (useImport ? activeImport?.aspectRatio : aspectRatio) || undefined,
    [useImport, activeImport, aspectRatio]
  );
  const resolvedBackgroundColor = React.useMemo(
    () => (useImport ? (activeImport?.backgroundColor as string | undefined) : backgroundColor) || undefined,
    [useImport, activeImport, backgroundColor]
  );
  const resolvedLoading = useImport ? (geImport ? loadingGe : loadingQe6) : isLoading;
  const resolvedShowModal = useImport ? false : showModal;

  const resolvedProjectId = React.useMemo(() => projectIdForAutosave || PROJECT_ID, [projectIdForAutosave]);
  const editorKey = React.useMemo(
    () =>
      activeImport?.meta?.projectId ||
      (activeImport?.meta?.jobId ? `import-${activeImport.meta.jobId}` : null) ||
      resolvedProjectId ||
      "rve-default",
    [activeImport, resolvedProjectId]
  );

  React.useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const targetTheme = "dark";

    root.setAttribute("data-theme", targetTheme);
    root.classList.remove("rve");
    root.classList.add("dark");
    localStorage.setItem("rve-extended-theme", targetTheme);
  }, []);

  const handleThemeChange = (themeId: string) => {
    console.log("Theme changed to:", themeId);
  };

  const availableThemes: CustomTheme[] = [
    {
      id: "rve",
      name: "RVE",
      className: "rve",
      color: "#3E8AF5",
    },
    {
      id: "dark",
      name: "Dark",
      className: "dark",
      color: "#1f2937",
    },
  ];

  const ssrRenderer = React.useMemo(
    () =>
      new HttpRenderer("/api/latest/ssr", {
        type: "ssr",
        entryPoint: "/api/latest/ssr",
      }),
    []
  );

  const sidebarWidth = React.useMemo(
    () => `calc(${SIDEBAR_ICON_WIDTH} + ${SIDEBAR_PANEL_WIDTH}px)`,
    []
  );

  return (
    <PostHogProvider>
      <div className={styles.viewport}>
        <div className={styles.canvas}>
          <MobileWarningModal show={SHOW_MOBILE_WARNING} />
          <ProjectLoadConfirmModal
            isVisible={resolvedShowModal}
            onConfirm={onConfirmLoad}
            onCancel={onCancelLoad}
          />
          <ReactVideoEditor
            key={editorKey}
            projectId={resolvedProjectId}
            defaultOverlays={resolvedOverlays}
            defaultAspectRatio={resolvedAspectRatio}
            defaultBackgroundColor={resolvedBackgroundColor}
            isLoadingProject={resolvedLoading}
            fps={activeImport?.fps || 30}
            showAutosaveStatus={!activeImport}
            renderer={ssrRenderer}
            disabledPanels={[]}
            availableThemes={availableThemes}
            defaultTheme="dark"
            hideThemeToggle
            adaptors={{
              video: [twelveLabsVideoAdaptor],
              images: [createPexelsImageAdaptor("CEOcPegZJRoNztih7auwNoFZmIFTmlYoZTI0NgTRCUxkFhXORBhERORM")],
            }}
            onThemeChange={handleThemeChange}
            showDefaultThemes={true}
            sidebarWidth={sidebarWidth}
            sidebarIconWidth={SIDEBAR_ICON_WIDTH}
            showIconTitles={false}
            className={styles.chrome}
            customSidebar={<Editor2Sidebar />}
          />
          <Toaster />
        </div>
      </div>
    </PostHogProvider>
  );
}
