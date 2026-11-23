"""Functions run only inside the dedicated inference process."""

import numpy as np

from src.inference.postprocess import yolo_result_to_raw

_model = None


def load_model(weights: str) -> None:
    global _model
    from ultralytics import YOLO

    _model = YOLO(weights)
    print(f"loaded {weights}")


def ready() -> bool:
    return _model is not None


def predict(frames):
    if _model is None:
        raise RuntimeError("Inference worker has not loaded its model")
    if isinstance(frames, np.ndarray):
        frames = [frames] if frames.ndim == 3 else list(frames)
    if not frames:
        return []
    return [
        yolo_result_to_raw(result) for result in _model.predict(frames, conf=0.35, verbose=False)
    ]
