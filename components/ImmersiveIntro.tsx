// Cinematic landing that plays before the editor opens.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import detectionData from "@/data/cv/kill-bill-clip-detections.json";

const INTRO_DURATION_MS = 2400;

type Box = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence?: number;
  span?: number;
};

type ImmersiveIntroProps = {
  isOverlay?: boolean;
  onDismiss?: () => void;
};

export default function ImmersiveIntro({ isOverlay = false, onDismiss }: ImmersiveIntroProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<"intro" | "hero" | "redirected">("intro");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(0.5);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [videoLayout, setVideoLayout] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [boxes, setBoxes] = useState<Box[]>([]);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  }, []);

  useEffect(() => {
    const introDelay = prefersReducedMotion ? 500 : INTRO_DURATION_MS;

    const introTimer = window.setTimeout(() => setPhase("hero"), introDelay);

    return () => {
      window.clearTimeout(introTimer);
    };
  }, [prefersReducedMotion, router]);

  // Real CV detections loaded from generated JSON (HOG people detector pass).
  const detectionTimeline = useMemo(() => {
    const frames = (detectionData as { frames?: any[] } | undefined)?.frames ?? [];
    return frames.map((frame, frameIdx) => {
      const boxes = (frame?.boxes ?? [])
        // Show everything down to a low threshold so tags remain visible.
        .filter((b: any) => (typeof b?.confidence === "number" ? b.confidence : 0) >= 0.05)
        .map((b: any, boxIdx: number) => {
          const [x1, y1, x2, y2] = b?.bbox_pct ?? [0, 0, 0, 0];
          return {
            id: `f${frameIdx}-b${boxIdx}-${b?.label ?? "obj"}`,
            label: b?.label ?? "object",
            x: x1,
            y: y1,
            w: Math.max(0, x2 - x1),
            h: Math.max(0, y2 - y1),
            confidence: b?.confidence,
            span: 1,
            bbox_px: b?.bbox_px,
          } as Box;
        });
      return { t: frame?.time ?? 0, boxes };
    });
  }, []);

  const clipStartTime = useMemo(() => {
    const first = detectionTimeline.find((f) => (f.boxes?.length ?? 0) > 0);
    return first ? Math.max(0, first.t - 0.05) : 0; // slight pre-roll
  }, [detectionTimeline]);

  useEffect(() => {
    const recomputeLayout = () => {
      const container = frameRef.current;
      if (!container || !videoAspect) return;
      const styles = window.getComputedStyle(container);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const cw = container.clientWidth - paddingX;
      const ch = container.clientHeight - paddingY;
      if (cw <= 0 || ch <= 0) return;
      const containerAspect = cw / ch;
      let vw: number;
      let vh: number;
      let left = parseFloat(styles.paddingLeft);
      let top = parseFloat(styles.paddingTop);
      if (containerAspect > videoAspect) {
        // Container is wider than video: pillarbox horizontally.
        vh = ch;
        vw = ch * videoAspect;
        left += (cw - vw) / 2;
      } else {
        // Container is taller than video: letterbox vertically.
        vw = cw;
        vh = cw / videoAspect;
        top += (ch - vh) / 2;
      }
      setVideoLayout({ width: vw, height: vh, left, top });
    };

    const resizeObserver = new ResizeObserver(recomputeLayout);
    const container = frameRef.current;
    if (container) {
      resizeObserver.observe(container);
    }

    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    const onLoaded = () => {
      if (!Number.isNaN(clipStartTime)) {
        video.currentTime = clipStartTime;
      }
      if (video.videoWidth && video.videoHeight) {
        setVideoAspect(video.videoWidth / video.videoHeight);
      }
      void video.play().catch(() => {});
      recomputeLayout();
    };
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("loadedmetadata", onLoaded);

    let raf: number;
    const tick = () => {
      const t = video.currentTime;
      // nearest keyframe in detection timeline
      const nearestWithIdx = detectionTimeline.reduce(
        (prev, curr, idx) => {
          const d = Math.abs(curr.t - t);
          if (d < prev.dist) return { frame: curr, dist: d, idx };
          return prev;
        },
        { frame: detectionTimeline[0], dist: Number.POSITIVE_INFINITY, idx: 0 }
      );
      const nearest = nearestWithIdx.frame;
      const persons = nearest.boxes
        .map((b, idx) => {
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          const area = b.w * b.h;
          const isPerson = b.label?.toLowerCase() === "person";
          const centerDist = Math.hypot(cx - 50, cy - 55);
          return { b, idx, isPerson, area, centerDist };
        })
        .filter((p) => p.isPerson);

      const brideCandidate = persons
        .filter((p) => p.area > 1200) // size floor
        .sort((a, b) => a.centerDist - b.centerDist || b.area - a.area)[0];

      const brideIdx = brideCandidate && brideCandidate.centerDist < 30 ? brideCandidate.idx : null;

      const decorated = nearest.boxes.map((b, idx) => {
        const isPerson = b.label?.toLowerCase() === "person";
        if (isPerson && brideIdx === idx) return { ...b, label: "The Bride" };
        if (isPerson) return { ...b, label: "Crazy 88 Member" };
        return b;
      });
      setBoxes(decorated);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    return () => {
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("loadedmetadata", onLoaded);
      window.cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
  }, [detectionTimeline, isPaused, playbackRate, clipStartTime, videoAspect]);

  const togglePause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
      setIsPaused(false);
    } else {
      video.pause();
      setIsPaused(true);
    }
  };

  const handleDismiss = () => {
    if (phase === "redirected") return;
    setPhase("redirected");
    if (onDismiss) {
      onDismiss();
    } else {
      router.push("/editor");
    }
  };

  const handleContinue = () => {
    // If we're shown as an overlay (editor entry), also kick off the generate edit flow.
    if (isOverlay && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("auto-generate-edit2", {
          detail: { action: "click-only" },
        })
      );
    }
    handleDismiss();
  };

  return (
    <div
      className={`${isOverlay ? "fixed inset-0 z-[9999]" : "relative"} min-h-screen bg-black text-white overflow-hidden`}
    >
      {isOverlay && (
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-5 top-5 z-[10000] inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 hover:text-white/90 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          aria-label="Close intro"
        >
          <span className="text-xl leading-none">&times;</span>
        </button>
      )}
      {/* Intro overlay */}
      <div
        className={`absolute inset-0 flex items-center justify-center bg-black transition-opacity duration-700 ${
          phase === "intro" ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="relative text-center px-6 py-20 sm:py-22 md:py-24">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.12] bg-gradient-to-br from-zinc-200 via-slate-300 to-zinc-100 bg-clip-text text-transparent drop-shadow-[0_25px_35px_rgba(0,0,0,0.45)] animate-titleGlow">
            The Attention Engine Demo
          </h1>
          <p className="mt-6 text-sm sm:text-base text-zinc-400 uppercase tracking-[0.3em] leading-relaxed animate-slowFade">
            Crafted for filmmakers and launch teams
          </p>
        </div>
      </div>

      {/* Hero section */}
      <main
        className={`relative z-10 min-h-screen flex flex-col justify-start transition-opacity duration-700 ${
          phase === "hero" || phase === "redirected" ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black via-zinc-950 to-black" aria-hidden="true" />
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.06),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(255,255,255,0.05),transparent_25%)]" />

        <div className="flex-1 w-full max-w-6xl mx-auto px-4 lg:px-6 py-0 sm:py-1 lg:py-2 flex flex-col items-center gap-1">
          <div className="text-center space-y-1">
            <p className="text-[11px] font-semibold tracking-[0.32em] text-zinc-500 uppercase">The Attention Engine</p>
            <p className="text-sm text-zinc-300 m-0">
              Dialog + computer vision + campaign playbooks fused to auto-build social-ready clips from your film.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-emerald-100/90">
            {[
              "NLP: understands every line of dialog",
              "CV: tracks on-screen action & characters",
              "Fusion: story + visuals = full context",
              "Playbook: viral movie marketing patterns",
              "Output: social-ready edits from the film",
            ].map((item) => (
              <span
                key={item}
                className="rounded-full border border-emerald-300/30 bg-emerald-300/5 px-2 py-1 leading-none"
              >
                {item}
              </span>
            ))}
          </div>

          <div className="relative w-full max-w-6xl">
            <div className="absolute -inset-8 bg-gradient-to-br from-white/5 via-transparent to-transparent blur-3xl opacity-50" />
            <div className="relative overflow-visible rounded-2xl border border-white/10 bg-black/50 backdrop-blur-md p-2 sm:p-3 shadow-[0_12px_32px_-28px_rgba(0,0,0,0.7)]">
              <div className="flex items-center justify-between gap-2 mb-1 text-[11px] sm:text-xs">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Scene intelligence</p>
                  <p className="text-sm font-semibold text-white">Understands every line and frame, then cuts viral edits for you.</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={togglePause}
                    className="h-8 px-2.5 rounded-full bg-white/10 border border-white/20 text-[11px] font-semibold uppercase tracking-[0.18em] hover:border-white/50 transition"
                  >
                    Play/Pause
                  </button>
                  <div className="flex items-center gap-1 rounded-full bg-white/5 border border-white/10 px-2 py-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/70 pl-0.5">Speed</span>
                    {[
                      { label: "0.5x", value: 0.5 },
                      { label: "1x", value: 1 },
                    ].map(({ label, value }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          setPlaybackRate(value);
                          const v = videoRef.current;
                          if (v) v.playbackRate = value;
                        }}
                        className={`px-1.5 py-0.5 text-[10px] rounded-full transition ${
                          playbackRate === value
                            ? "bg-emerald-400 text-black font-semibold"
                            : "bg-transparent text-white hover:bg-white/10"
                        }`}
                        aria-label={`Set playback speed to ${label}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-200">
                <span>Computer vision tagging overlay</span>
                <span className="rounded-full bg-white/5 px-2 py-1 border border-white/10">Timestamp: 1:21:30 – 1:21:34</span>
              </div>

              <div className="flex flex-col gap-2">
                <div
                  ref={frameRef}
                  className="relative w-full max-h-[55vh] overflow-visible rounded-2xl border border-white/10 bg-black/90 p-2 sm:p-3"
                  style={{ aspectRatio: videoAspect || "16/9" }}
                >
                  <div
                    className="absolute rounded-2xl overflow-hidden"
                    style={
                      videoLayout.width > 0
                        ? {
                            width: videoLayout.width,
                            height: videoLayout.height,
                            left: videoLayout.left,
                            top: videoLayout.top,
                          }
                        : { inset: "12px" }
                    }
                  >
                    <video
                      ref={videoRef}
                      src="/Kill_Bill_Vol1_Part2_30FPS_1428s-1432s.mp4"
                      className="h-full w-full object-contain bg-black"
                      autoPlay
                      muted
                      loop
                      playsInline
                    />
                  </div>
                  <div
                    className="pointer-events-none absolute rounded-2xl"
                    style={
                      videoLayout.width > 0
                        ? {
                            width: videoLayout.width,
                            height: videoLayout.height,
                            left: videoLayout.left,
                            top: videoLayout.top,
                          }
                        : { inset: "12px" }
                    }
                  >
                    {[...boxes]
                      // draw smaller boxes on top so their labels stay visible
                      .sort((a, b) => a.w * a.h - b.w * b.h)
                      .map((box, idx) => {
                        return (
                          <div
                            key={box.id}
                            className="absolute border border-emerald-300/80 bg-emerald-300/10 backdrop-blur-[2px] shadow-[0_0_0_1px_rgba(16,185,129,0.4)]"
                            style={{
                              left: `${box.x}%`,
                              top: `${box.y}%`,
                              width: `${box.w}%`,
                              height: `${box.h}%`,
                              zIndex: 10 + idx,
                            }}
                          >
                            <div
                              className="absolute max-w-[220px] whitespace-nowrap bg-emerald-400 text-black text-[11px] font-semibold px-2 py-1 shadow-[0_8px_16px_-10px_rgba(16,185,129,0.7)]"
                              style={{
                                left: "50%",
                                transform: "translateX(-50%)",
                                top: "-26px",
                              }}
                            >
                              {box.label}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>

                <div className="mt-0 flex flex-col items-center gap-1 text-center">
                  <p className="text-sm text-zinc-200 m-0">
                    Test the world's best AI fan edit creation tool.
                  </p>
                  <div className="mt-1 flex flex-col sm:flex-row items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleContinue}
                      className="inline-flex items-center justify-center px-6 py-3.5 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300 text-black text-base font-semibold tracking-[0.2em] uppercase shadow-[0_18px_42px_-16px_rgba(16,185,129,0.7)] ring-2 ring-emerald-200/80 hover:scale-[1.05] transition"
                    >
                      Generate Fan Edit
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[12px] text-zinc-400">
            <span className="rounded-full border border-white/10 px-3 py-1 bg-white/5">Dialogue understood: 100%</span>
            <span className="rounded-full border border-white/10 px-3 py-1 bg-white/5">Visual tags: 1,700 detections</span>
            <span className="rounded-full border border-white/10 px-3 py-1 bg-white/5">Playbook: 50+ viral patterns</span>
          </div>
        </div>
      </main>

      <style jsx global>{`
        @keyframes titleGlow {
          0% {
            text-shadow: 0 20px 60px rgba(255, 255, 255, 0.08), 0 0 0 rgba(255, 255, 255, 0.08);
            transform: translateY(0);
          }
          50% {
            text-shadow: 0 25px 80px rgba(255, 255, 255, 0.18), 0 0 22px rgba(255, 255, 255, 0.18);
            transform: translateY(-2px) scale(1.01);
          }
          100% {
            text-shadow: 0 20px 60px rgba(255, 255, 255, 0.08), 0 0 0 rgba(255, 255, 255, 0.08);
            transform: translateY(0);
          }
        }
        @keyframes slowFade {
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          40% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 1;
          }
        }
        @keyframes progressBar {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(0%);
          }
        }
        .animate-titleGlow {
          animation: titleGlow 2.4s ease-in-out infinite;
        }
        .animate-slowFade {
          animation: slowFade 1.6s ease-out forwards;
        }
        .animate-progressBar {
          animation: progressBar 3.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
