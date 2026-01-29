"use client";

import React from "react";
import { FolderOpen, Music, Subtitles, Type, Settings, ArrowLeft, X, Sparkles, Search, Zap, Home } from "lucide-react";
import { useRouter } from "next/navigation";

import { Overlay, OverlayType } from "@editor/reactvideoeditor/types";
import { useEditorSidebar } from "@editor/reactvideoeditor/contexts/sidebar-context";
import { useEditorContext } from "@editor/reactvideoeditor/contexts/editor-context";

import { VideoOverlayPanel } from "@editor/reactvideoeditor/components/overlay/video/video-overlay-panel";
import { TextOverlaysPanel } from "@editor/reactvideoeditor/components/overlay/text/text-overlays-panel";
import SoundsOverlayPanel from "@editor/reactvideoeditor/components/overlay/sounds/sounds-overlay-panel";
import { CaptionsOverlayPanel } from "@editor/reactvideoeditor/components/overlay/captions/captions-overlay-panel";
import { ImageOverlayPanel } from "@editor/reactvideoeditor/components/overlay/images/image-overlay-panel";
import { LocalMediaPanel } from "@editor/reactvideoeditor/components/overlay/local-media/local-media-panel";
import { StickersPanel } from "@editor/reactvideoeditor/components/overlay/stickers/stickers-panel";
import { SettingsPanel } from "@editor/reactvideoeditor/components/settings/settings-panel";
import { ClipsOverlayPanel } from "@editor/reactvideoeditor/components/overlay/clips/clips-overlay-panel";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@editor/reactvideoeditor/components/ui/sidebar";
import { Button } from "@editor/reactvideoeditor/components/ui/button";
import { cn } from "@editor/reactvideoeditor/utils/general/utils";
import styles from "./editor2-layout.module.css";
import { InstantDemoOverlay } from "./InstantDemoOverlay";
import { GenerateEditOverlay } from "./GenerateEditOverlay";

type NavItem = {
  title: string;
  panel: OverlayType;
  icon: React.ComponentType<{ className?: string }>;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navigation: NavGroup[] = [
  {
    label: "Media",
    items: [
      { title: "Search", panel: OverlayType.VIDEO, icon: Search },
      // TODO(version2-post-launch): Re-enable Clips entry.
      // { title: "Clips", panel: OverlayType.SEARCH, icon: Clapperboard },
      // TODO(version2-post-launch): Re-enable Images entry.
      // { title: "Images", panel: OverlayType.IMAGE, icon: ImageIcon },
      { title: "Uploads", panel: OverlayType.LOCAL_DIR, icon: FolderOpen },
    ],
  },
  {
    label: "Audio",
    items: [
      { title: "Audio", panel: OverlayType.SOUND, icon: Music },
      { title: "Captions", panel: OverlayType.CAPTION, icon: Subtitles },
    ],
  },
  {
    label: "Creative",
    items: [
      { title: "Text", panel: OverlayType.TEXT, icon: Type },
    ],
  },
];

const RAIL_TOOLTIP_LABELS = new Set([
  "Home",
  "Generate Edit",
  "Instant Demo",
  "Search",
  "Uploads",
  "Audio",
  "Captions",
  "Text",
  "Settings",
]);

const renderActivePanel = (panel?: OverlayType | null) => {
  switch (panel) {
    case OverlayType.TEXT:
      return <TextOverlaysPanel />;
    case OverlayType.SOUND:
      return <SoundsOverlayPanel />;
    case OverlayType.SEARCH:
      return <ClipsOverlayPanel />;
    case OverlayType.VIDEO:
      return <VideoOverlayPanel />;
    case OverlayType.CAPTION:
      return <CaptionsOverlayPanel />;
    case OverlayType.IMAGE:
      return <ImageOverlayPanel />;
    case OverlayType.STICKER:
      return <StickersPanel />;
    case OverlayType.LOCAL_DIR:
      return <LocalMediaPanel />;
    case OverlayType.SETTINGS:
      return <SettingsPanel />;
    default:
      return null;
  }
};

const getPanelTitle = (panel?: OverlayType | null) => {
  switch (panel) {
    case OverlayType.VIDEO:
      return "Search";
    case OverlayType.TEXT:
      return "Text";
    case OverlayType.SEARCH:
      return "Clips";
    case OverlayType.SOUND:
      return "Audio";
    case OverlayType.CAPTION:
      return "Captions";
    case OverlayType.IMAGE:
      return "Images";
    case OverlayType.STICKER:
      return "Stickers";
    case OverlayType.LOCAL_DIR:
      return "Uploads";
    case OverlayType.SETTINGS:
      return "Settings";
    default:
      return "Panels";
  }
};

export const Editor2Sidebar: React.FC = () => {
  const { activePanel, setActivePanel, setIsOpen } = useEditorSidebar();
  const { setSelectedOverlayId, selectedOverlayId, overlays } = useEditorContext();
  const uiSidebar = useSidebar();
  const router = useRouter();
  const [tooltip, setTooltip] = React.useState<{
    label: string;
    x: number;
    y: number;
    visible: boolean;
    region: "rail" | "panel" | null;
  }>({
    label: "",
    x: 0,
    y: 0,
    visible: false,
    region: null,
  });

  const [geOverlayOpen, setGeOverlayOpen] = React.useState(false);
  const [instantOpen, setInstantOpen] = React.useState(false);

  const selectedOverlay =
    selectedOverlayId !== null ? overlays.find((overlay) => overlay.id === selectedOverlayId) : null;
  const shouldShowBackButton = selectedOverlay && selectedOverlay.type === activePanel;

  const handleNavigate = (panel: OverlayType) => {
    // Close long-running overlays when switching panels
    setInstantOpen(false);
    setGeOverlayOpen(false);
    setActivePanel(panel);
    setIsOpen(true);
  };

  return (
    <Sidebar
      collapsible="icon"
      className={styles.sidebarShell}
    >
      <div className={cn(styles.sidebarRail, "w-[calc(var(--sidebar-width-icon)+1px)]!")}>
        <SidebarHeader className={styles.sidebarHeader}>
          <div className={styles.sidebarMark}>FE</div>
        </SidebarHeader>

        <SidebarContent className="border-t border-border">
          <SidebarGroup className={styles.sidebarGroup}>
            <div className={styles.sidebarGroupLabel}>AI</div>
            <SidebarMenu className={styles.sidebarMenu}>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => router.push("/")}
                  data-label="Home"
                  className={cn(styles.navPill)}
                  title="Home"
                  aria-label="Home"
                  onMouseEnter={(e) => {
                    if (!RAIL_TOOLTIP_LABELS.has("Home")) return;
                    setTooltip({
                      label: "Home",
                      x: e.clientX,
                      y: e.clientY,
                      visible: true,
                      region: "rail",
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!RAIL_TOOLTIP_LABELS.has("Home")) return;
                    setTooltip((t) => ({
                      ...t,
                      x: e.clientX,
                      y: e.clientY,
                      region: "rail",
                    }));
                  }}
                  onMouseLeave={() =>
                    setTooltip((t) => ({
                      ...t,
                      visible: false,
                      region: null,
                    }))
                  }
                >
                  <Home />
                  <span className={styles.navLabel}>Home</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => {
                    setGeOverlayOpen(false);
                    setInstantOpen(true);
                  }}
                  data-label="Instant Demo"
                  className={cn(styles.navPill)}
                  title="Instant Demo"
                  aria-label="Instant Demo"
                  onMouseEnter={(e) => {
                    if (!RAIL_TOOLTIP_LABELS.has("Instant Demo")) return;
                    setTooltip({
                      label: "Instant Demo",
                      x: e.clientX,
                      y: e.clientY,
                      visible: true,
                      region: "rail",
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!RAIL_TOOLTIP_LABELS.has("Instant Demo")) return;
                    setTooltip((t) => ({
                      ...t,
                      x: e.clientX,
                      y: e.clientY,
                      region: "rail",
                    }));
                  }}
                  onMouseLeave={() =>
                    setTooltip((t) => ({
                      ...t,
                      visible: false,
                      region: null,
                    }))
                  }
                >
                  <Zap />
                  <span className={styles.navLabel}>Instant</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => {
                    setInstantOpen(false);
                    setGeOverlayOpen(true);
                  }}
                  data-label="Generate Edit"
                  className={cn(styles.navPill)}
                  title="Generate Edit"
                  aria-label="Generate Edit"
                  onMouseEnter={(e) => {
                    if (!RAIL_TOOLTIP_LABELS.has("Generate Edit")) return;
                    setTooltip({
                      label: "Generate Edit",
                      x: e.clientX,
                      y: e.clientY,
                      visible: true,
                      region: "rail",
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!RAIL_TOOLTIP_LABELS.has("Generate Edit")) return;
                    setTooltip((t) => ({
                      ...t,
                      x: e.clientX,
                      y: e.clientY,
                      region: "rail",
                    }));
                  }}
                  onMouseLeave={() =>
                    setTooltip((t) => ({
                      ...t,
                      visible: false,
                      region: null,
                    }))
                  }
                >
                <Sparkles />
                  <span className={styles.navLabel}>Gen Edit</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          {navigation.map((group) => (
            <SidebarGroup key={group.label} className={styles.sidebarGroup}>
              <div className={styles.sidebarGroupLabel}>{group.label}</div>
              <SidebarMenu className={styles.sidebarMenu}>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      onClick={() => handleNavigate(item.panel)}
                      data-label={item.title}
                      className={cn(
                        styles.navPill,
                        activePanel === item.panel && styles.navPillActive
                      )}
                      data-active={activePanel === item.panel}
                      title={item.title}
                      aria-label={item.title}
                      onMouseEnter={(e) => {
                        if (!RAIL_TOOLTIP_LABELS.has(item.title)) return;
                        setTooltip({
                          label: item.title,
                          x: e.clientX,
                          y: e.clientY,
                          visible: true,
                          region: "rail",
                        });
                      }}
                      onMouseMove={(e) => {
                        if (!RAIL_TOOLTIP_LABELS.has(item.title)) return;
                        setTooltip((t) => ({
                          ...t,
                          x: e.clientX,
                          y: e.clientY,
                          region: "rail",
                        }));
                      }}
                      onMouseLeave={() =>
                        setTooltip((t) => ({
                          ...t,
                          visible: false,
                          region: null,
                        }))
                      }
                    >
                      <item.icon />
                      <span className={styles.navLabel}>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className={styles.sidebarFooter}>
          <SidebarMenu className={styles.sidebarMenu}>
            <SidebarMenuItem>
              <SidebarMenuButton
                className={cn(styles.navPill, activePanel === OverlayType.SETTINGS && styles.navPillActive)}
                onClick={() => handleNavigate(OverlayType.SETTINGS)}
                aria-label="Settings"
                title="Settings"
                data-label="Settings"
                onMouseEnter={(e) =>
                  setTooltip((prev) =>
                    RAIL_TOOLTIP_LABELS.has("Settings")
                      ? {
                          label: "Settings",
                          x: e.clientX,
                          y: e.clientY,
                          visible: true,
                          region: "rail",
                        }
                      : prev
                  )
                }
                onMouseMove={(e) =>
                  setTooltip((t) =>
                    RAIL_TOOLTIP_LABELS.has("Settings")
                      ? {
                          ...t,
                          x: e.clientX,
                          y: e.clientY,
                          region: "rail",
                        }
                      : t
                  )
                }
                onMouseLeave={() =>
                  setTooltip((t) => ({
                    ...t,
                    visible: false,
                    region: null,
                  }))
                }
              >
                <Settings />
                <span className={styles.navLabel}>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </div>

      <div className={cn(styles.sidebarPanelSurface)} data-state={uiSidebar.state}>
        <div className={styles.sidebarPanelHeader}>
          <div className={styles.panelTitle}>{getPanelTitle(activePanel)}</div>
          <div className="flex items-center gap-2">
            {shouldShowBackButton && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setSelectedOverlayId(null)}
                aria-label="Back to all items"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Collapse sidebar"
              onClick={() => {
                uiSidebar.setOpen(false);
                setIsOpen(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <SidebarContent className={styles.sidebarPanelContent}>{renderActivePanel(activePanel)}</SidebarContent>
      </div>

      {tooltip.visible && tooltip.region === "rail" && RAIL_TOOLTIP_LABELS.has(tooltip.label) && (
        <div
          className={styles.sidebarTooltip}
          style={{ left: tooltip.x, top: tooltip.y }}
          aria-hidden
        >
          {tooltip.label}
        </div>
      )}

      <GenerateEditOverlay open={geOverlayOpen} onClose={() => setGeOverlayOpen(false)} />
      <InstantDemoOverlay open={instantOpen} onClose={() => setInstantOpen(false)} />
    </Sidebar>
  );
};
