"""
Computer vision pass on the Kill Bill clip using YOLOv8n (Ultralytics).
Outputs normalized bounding boxes to data/cv/kill-bill-clip-detections.json.
"""

import json
from pathlib import Path

import cv2
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent
VIDEO_PATH = ROOT / "public" / "Kill_Bill_Vol1_Part2_30FPS_1428s-1432s.mp4"
OUT_PATH = ROOT / "data" / "cv" / "kill-bill-clip-detections.json"


ALLOWED_CLASSES = {"person"}


def run_detection(sample_fps: float = 3.0, conf: float = 0.4, imgsz: int = 960):
    model = YOLO("yolov8n.pt")

    cap = cv2.VideoCapture(str(VIDEO_PATH))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video at {VIDEO_PATH}")

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    stride = max(1, int(round(video_fps / sample_fps)))

    frames = []
    frame_idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_idx % stride != 0:
            frame_idx += 1
            continue

        h, w = frame.shape[:2]
        results = model.predict(source=frame, imgsz=imgsz, conf=conf, verbose=False)

        boxes = []
        if results and len(results) > 0:
            r = results[0]
            names = r.names
            if r.boxes is not None:
                for b in r.boxes:
                    x1, y1, x2, y2 = b.xyxy[0].tolist()
                    cls_id = int(b.cls[0].item()) if b.cls is not None else -1
                    conf_score = float(b.conf[0].item()) if b.conf is not None else None
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(w - 1, x2), min(h - 1, y2)
                    label_name = names.get(cls_id, f"class-{cls_id}") if isinstance(names, dict) else str(cls_id)
                    if ALLOWED_CLASSES and label_name not in ALLOWED_CLASSES:
                        continue
                    boxes.append(
                        {
                            "label": label_name,
                            "confidence": round(conf_score, 3) if conf_score is not None else None,
                            "bbox_px": [int(x1), int(y1), int(x2), int(y2)],
                            "bbox_pct": [
                                round(100 * x1 / w, 2),
                                round(100 * y1 / h, 2),
                                round(100 * x2 / w, 2),
                                round(100 * y2 / h, 2),
                            ],
                        }
                    )

        frames.append(
            {
                "time": round(frame_idx / video_fps, 3),
                "frame_index": frame_idx,
                "boxes": boxes,
            }
        )
        frame_idx += 1

    cap.release()

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w") as f:
        json.dump(
            {
                "source": str(VIDEO_PATH.relative_to(ROOT)),
                "sample_fps": sample_fps,
                "video_fps": video_fps,
                "model": "yolov8n.pt",
                "conf": conf,
                "imgsz": imgsz,
                "frames": frames,
            },
            f,
            indent=2,
        )
    return OUT_PATH


if __name__ == "__main__":
    out_path = run_detection()
    print(f"Wrote detections to {out_path}")
