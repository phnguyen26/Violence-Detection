"""Compatibility imports for existing inference scripts."""

from src.inference.postprocess import (
    RawDetection,
    SmoothedBox,
    TemporalBuffer,
    draw_confirmed,
    yolo_result_to_raw,
)

__all__ = ["RawDetection", "SmoothedBox", "TemporalBuffer", "draw_confirmed", "yolo_result_to_raw"]
