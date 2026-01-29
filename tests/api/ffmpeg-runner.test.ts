/**
 * @jest-environment node
 */
import { buildFilterGraph } from "../../app/api/render/lib/ffmpeg-runner";
import { OverlayType } from "../../app/editor3/reactvideoeditor/types";

describe("buildFilterGraph", () => {
  it("builds overlay, audio, and text filters with timing", () => {
    const graph = buildFilterGraph({
      inputs: [
        {
          kind: "video",
          overlay: {
            id: 1,
            type: OverlayType.VIDEO,
            durationInFrames: 60,
            from: 0,
            height: 360,
            width: 640,
            row: 0,
            left: 10,
            top: 20,
            isDragging: false,
            rotation: 0,
            content: "clip",
            src: "/videos/a.mp4",
          } as any,
          filePath: "/tmp/a.mp4",
          startSec: 0,
          endSec: 2,
          width: 640,
          height: 360,
          left: 10,
          top: 20,
        },
        {
          kind: "audio",
          overlay: {
            id: 2,
            type: OverlayType.SOUND,
            durationInFrames: 60,
            from: 30,
            height: 0,
            width: 0,
            row: 0,
            left: 0,
            top: 0,
            isDragging: false,
            rotation: 0,
            content: "audio",
            src: "/audio/a.mp3",
          } as any,
          filePath: "/tmp/a.mp3",
          startSec: 1,
          endSec: 3,
          width: 0,
          height: 0,
          left: 0,
          top: 0,
        },
        {
          kind: "text",
          overlay: {
            id: 3,
            type: OverlayType.TEXT,
            durationInFrames: 30,
            from: 0,
            height: 0,
            width: 0,
            row: 0,
            left: 100,
            top: 120,
            isDragging: false,
            rotation: 0,
            content: "Hello",
            styles: { fontSize: "24", color: "white" },
          } as any,
          filePath: "",
          startSec: 0,
          endSec: 1,
          width: 0,
          height: 0,
          left: 100,
          top: 120,
        },
      ],
      durationSeconds: 5,
      fps: 30,
      width: 800,
      height: 600,
      backgroundColor: "black",
    });

    expect(graph.args).toEqual(
      expect.arrayContaining([
        "-f",
        "lavfi",
        "-i",
        expect.stringContaining("color=size=800x600"),
      ])
    );

    expect(graph.filterComplex).toContain(
      "overlay=x=10:y=20:enable='between(t,0.000,2.000)'"
    );
    expect(graph.filterComplex).toContain("adelay=1000|1000");
    expect(graph.filterComplex).toContain("drawtext=text='Hello'");
    expect(graph.finalVideoLabel).toContain("base");
  });
});
