from __future__ import annotations

import base64
import threading
from pathlib import Path
from typing import Dict, List

import cv2
import numpy as np

from config import (
    FACE_DETECTION_NMS_THRESHOLD,
    FACE_DETECTION_SCORE_THRESHOLD,
    FACE_DETECTION_TOP_K,
    FACE_DETECTOR_MODEL,
    FACE_QUERY_FALLBACK_SIZE,
    FACE_RECOGNIZER_MODEL,
)


_model_lock = threading.Lock()
_detector = None
_recognizer = None


def model_paths() -> Dict[str, str]:
    return {
        "detector": str(FACE_DETECTOR_MODEL),
        "recognizer": str(FACE_RECOGNIZER_MODEL),
    }


def models_ready() -> bool:
    return FACE_DETECTOR_MODEL.is_file() and FACE_RECOGNIZER_MODEL.is_file()


def _require_model(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Missing model file: {path}")


def get_models():
    global _detector, _recognizer

    with _model_lock:
        if _detector is None:
            _require_model(FACE_DETECTOR_MODEL)
            _detector = cv2.FaceDetectorYN.create(
                str(FACE_DETECTOR_MODEL),
                "",
                (320, 320),
                FACE_DETECTION_SCORE_THRESHOLD,
                FACE_DETECTION_NMS_THRESHOLD,
                FACE_DETECTION_TOP_K,
            )
        if _recognizer is None:
            _require_model(FACE_RECOGNIZER_MODEL)
            _recognizer = cv2.FaceRecognizerSF.create(str(FACE_RECOGNIZER_MODEL), "")

        return _detector, _recognizer


def decode_base64_image(image_b64: str) -> np.ndarray:
    raw = base64.b64decode(image_b64, validate=True)
    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image bytes")
    return image


def _normalize_feature(feature: np.ndarray) -> np.ndarray:
    vector = np.asarray(feature, dtype=np.float32).reshape(-1)
    norm = np.linalg.norm(vector)
    if norm == 0:
        return vector
    return vector / norm


def detect_faces(image: np.ndarray) -> np.ndarray:
    detector, _ = get_models()
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    if faces is None:
        return np.zeros((0, 15), dtype=np.float32)
    return np.asarray(faces, dtype=np.float32)


def extract_query_embedding(image: np.ndarray) -> np.ndarray:
    faces = detect_faces(image)
    _, recognizer = get_models()

    if len(faces) > 0:
        best_face = faces[np.argmax(faces[:, -1])]
        aligned = recognizer.alignCrop(image, best_face)
        feature = recognizer.feature(aligned)
        return _normalize_feature(feature)

    resized = cv2.resize(image, (FACE_QUERY_FALLBACK_SIZE, FACE_QUERY_FALLBACK_SIZE))
    feature = recognizer.feature(resized)
    return _normalize_feature(feature)


def extract_photo_embeddings(image: np.ndarray) -> List[Dict[str, object]]:
    faces = detect_faces(image)
    if len(faces) == 0:
        return []

    _, recognizer = get_models()
    results: List[Dict[str, object]] = []

    for index, face in enumerate(faces):
        aligned = recognizer.alignCrop(image, face)
        feature = recognizer.feature(aligned)
        bbox = {
            "x": float(face[0]),
            "y": float(face[1]),
            "width": float(face[2]),
            "height": float(face[3]),
        }
        results.append(
            {
                "face_index": index,
                "embedding": _normalize_feature(feature),
                "bounding_box": bbox,
                "confidence": float(face[-1]),
            }
        )

    return results


def warmup() -> None:
    if not models_ready():
        return
    blank = np.zeros((FACE_QUERY_FALLBACK_SIZE, FACE_QUERY_FALLBACK_SIZE, 3), dtype=np.uint8)
    extract_query_embedding(blank)

