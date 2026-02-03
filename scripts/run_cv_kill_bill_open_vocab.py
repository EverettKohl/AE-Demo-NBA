"""
Open-vocabulary computer vision pass on the Kill Bill clip using OWL-ViT.
Prompts target katana/sword and yellow jumpsuit. Outputs normalized boxes to
data/cv/kill-bill-clip-detections.json (overwrites), while the previous YOLO
run is backed up to kill-bill-clip-detections.yolov8.json.
"""

import json
from pathlib import Path
from typing import List

import cv2
import torch
from transformers import OwlViTForObjectDetection, OwlViTProcessor

ROOT = Path(__file__).resolve().parent.parent
VIDEO_PATH = ROOT / "public" / "Kill_Bill_Vol1_Part2_30FPS_1428s-1432s.mp4"
OUT_PATH = ROOT / "data" / "cv" / "kill-bill-clip-detections.json"


def run_detection(
    sample_fps: float = 2.0,
    score_threshold: float = 0.20,
    model_id: str = "google/owlvit-base-patch32",
    prompts: List[str] | None = None,
):
    prompts = prompts or ["katana", "sword", "blade", "yellow jumpsuit", "yellow suit", "yellow outfit"]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = OwlViTProcessor.from_pretrained(model_id)
    model = OwlViTForObjectDetection.from_pretrained(model_id).to(device)

    cap = cv2.VideoCapture(str(VIDEO_PATH))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video at {VIDEO_PATH}")

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    stride = max(1, int(round(video_fps / sample_fps)))

    frames = []
    frame_idx = 0
    while True:
        ok, frame_bgr = cap.read()
        if not ok:
            break
        if frame_idx % stride != 0:
            frame_idx += 1
            continue

        # Convert BGR (cv2) to RGB for the model
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        h, w = frame_rgb.shape[:2]

        inputs = processor(text=prompts, images=frame_rgb, return_tensors="pt").to(device)
        with torch.no_grad():
            outputs = model(**inputs)
        target_sizes = torch.tensor([[h, w]], device=device)
        results = processor.post_process_object_detection(outputs=outputs, threshold=score_threshold, target_sizes=target_sizes)[0]

        boxes = []
        for box, score, label_idx in zip(results["boxes"], results["scores"], results["labels"]):
            conf = float(score.item())
            label = prompts[int(label_idx)]
            x1, y1, x2, y2 = [float(v) for v in box.tolist()]
            x1, y1 = max(0.0, x1), max(0.0, y1)
            x2, y2 = min(float(w - 1), x2), min(float(h - 1), y2)
            boxes.append(
                {
                    "label": label,
                    "confidence": round(conf, 3),
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
                "model": model_id,
                "score_threshold": score_threshold,
                "prompts": prompts,
                "frames": frames,
            },
            f,
            indent=2,
        )
    return OUT_PATH


if __name__ == "__main__":
    out_path = run_detection()
    print(f"Wrote detections to {out_path}")
