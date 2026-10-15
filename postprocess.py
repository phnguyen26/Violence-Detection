"""
1. Flickering boxes  – a single-frame false positive causes a box to flash on/off.
2. Jittery boxes     – box coordinates jump a few pixels every frame.
3. Low-trust labels  – a 26 % detection gets drawn the same as a 90 % one.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import cv2
import numpy as np


# Data classes
@dataclass
class RawDetection:
    """One raw YOLO detection for a single frame."""

    cls_name: str
    conf: float
    xyxy: list[float]  # [x1, y1, x2, y2]


@dataclass
class SmoothedBox:
    """EMA-smoothed box that persists across frames."""

    cls_name: str
    conf_ema: float
    xyxy_ema: np.ndarray
    hit_count: int = 0


# buffer
class TemporalBuffer:
    def __init__(
        self,
        window: int = 8,
        min_hits: int = 4,
        ema_alpha: float = 0.4,
        iou_thresh: float = 0.3,
    ) -> None:
        self.window = window
        self.min_hits = min_hits
        self.ema_alpha = ema_alpha
        self.iou_thresh = iou_thresh

        self._history: deque[list[RawDetection]] = deque(maxlen=window)
        self._smoothed: list[SmoothedBox] = []

    def update(self, detections: list[RawDetection]) -> list[SmoothedBox]:
        self._history.append(detections)
        self._update_smoothed(detections)
        return self.confirmed()

    def confirmed(self) -> list[SmoothedBox]:
        """Return only boxes that have enough temporal support."""
        return [b for b in self._smoothed if b.hit_count >= self.min_hits]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _update_smoothed(self, new_dets: list[RawDetection]) -> None:
        matched_smooth_ids: set[int] = set()
        matched_det_ids: set[int] = set()

        # 1. Try to match new detections to existing smoothed boxes
        for di, det in enumerate(new_dets):
            best_iou, best_si = 0.0, -1
            for si, sbox in enumerate(self._smoothed):
                if sbox.cls_name != det.cls_name:
                    continue
                iou = _iou(det.xyxy, sbox.xyxy_ema.tolist())
                if iou > best_iou:
                    best_iou, best_si = iou, si

            if best_iou >= self.iou_thresh:
                # Matched — EMA update
                si = best_si
                a = self.ema_alpha
                self._smoothed[si].xyxy_ema = (
                    a * np.array(det.xyxy) + (1 - a) * self._smoothed[si].xyxy_ema
                )
                self._smoothed[si].conf_ema = (
                    a * det.conf + (1 - a) * self._smoothed[si].conf_ema
                )
                self._smoothed[si].hit_count = min(
                    self._smoothed[si].hit_count + 1, self.window
                )
                matched_smooth_ids.add(si)
                matched_det_ids.add(di)

        # 2. Unmatched new detections → create new smoothed box.
        #    Record their indices so step 3 does NOT penalise them.
        new_box_ids: set[int] = set()
        for di, det in enumerate(new_dets):
            if di not in matched_det_ids:
                new_box_ids.add(len(self._smoothed))
                self._smoothed.append(
                    SmoothedBox(
                        cls_name=det.cls_name,
                        conf_ema=det.conf,
                        xyxy_ema=np.array(det.xyxy, dtype=float),
                        hit_count=1,
                    )
                )

        # 3. Unmatched *existing* boxes → decay; brand-new boxes are left alone.
        survivors = []
        for si, sbox in enumerate(self._smoothed):
            if si not in matched_smooth_ids and si not in new_box_ids:
                sbox.hit_count = max(0, sbox.hit_count - 1)
            if sbox.hit_count > 0:
                survivors.append(sbox)
        self._smoothed = survivors


# ---------------------------------------------------------------------------
# Drawing helper
# ---------------------------------------------------------------------------
# Colour map: green for non-violence, red for violence keywords
_VIOLENCE_KEYWORDS = {"violence", "fight", "weapon", "assault", "attack"}


def _box_color(cls_name: str) -> tuple[int, int, int]:
    if any(kw in cls_name.lower() for kw in _VIOLENCE_KEYWORDS):
        return (0, 0, 220)  # red (BGR)
    return (0, 200, 0)  # green


def draw_confirmed(
    frame: np.ndarray,
    confirmed: list[SmoothedBox],
    line_thickness: int = 2,
    font_scale: float = 0.6,
) -> np.ndarray:
    """
    Draw only temporally confirmed, EMA-smoothed boxes onto *frame* (in-place).
    Opacity of the box scales with confidence so uncertain boxes look faint.
    """
    overlay = frame.copy()
    for box in confirmed:
        x1, y1, x2, y2 = (int(v) for v in box.xyxy_ema)
        color = _box_color(box.cls_name)
        label = f"{box.cls_name} {box.conf_ema * 100:.0f}%"

        # alpha driven by confidence
        alpha = 0.15 + 0.25 * box.conf_ema  # 0.15 … 0.40
        cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
        cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)

        # thickness scales with confidence
        thickness = int(line_thickness + box.conf_ema * 2)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)

        # Label background
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
        cv2.rectangle(frame, (x1, y1 - th - 8), (x1 + tw + 4, y1), color, -1)
        cv2.putText(
            frame,
            label,
            (x1 + 2, y1 - 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
    return frame


# ---------------------------------------------------------------------------
# Conversion helper
# ---------------------------------------------------------------------------
def yolo_result_to_raw(result) -> list[RawDetection]:
    names = result.names
    dets = []
    for box in result.boxes:
        dets.append(
            RawDetection(
                cls_name=names[int(box.cls)],
                conf=float(box.conf),
                xyxy=box.xyxy[0].tolist(),
            )
        )
    return dets


# ---------------------------------------------------------------------------
# IoU utility
# ---------------------------------------------------------------------------
def _iou(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0
