from __future__ import annotations

import base64
import threading
from pathlib import Path
from typing import Dict, List

import cv2
import numpy as np

from config import (
    FACE_DETECTION_MAX_SIDE,
    FACE_DETECTION_NMS_THRESHOLD,
    FACE_DETECTION_SCORE_THRESHOLD,
    FACE_DETECTION_TOP_K,
    FACE_DETECTOR_MODEL,
    FACE_QUERY_FALLBACK_SIZE,
    FACE_QUERY_SCORE_THRESHOLD,
    FACE_RECOGNIZER_MODEL,
    OPENCV_NUM_THREADS,
)

# Avoid each enrollment worker spawning a full set of OpenCV threads.
cv2.setNumThreads(OPENCV_NUM_THREADS)


class NoFaceDetected(Exception):
    """Raised when a query frame contains no usable face."""


_tls = threading.local()  # per-thread model instances


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
    """Return (detector, recognizer) that are private to the calling thread."""
    detector = getattr(_tls, "detector", None)
    recognizer = getattr(_tls, "recognizer", None)

    if detector is None:
        _require_model(FACE_DETECTOR_MODEL)
        detector = cv2.FaceDetectorYN.create(
            str(FACE_DETECTOR_MODEL),
            "",
            (320, 320),
            min(FACE_DETECTION_SCORE_THRESHOLD, FACE_QUERY_SCORE_THRESHOLD),
            FACE_DETECTION_NMS_THRESHOLD,
            FACE_DETECTION_TOP_K,
        )
        _tls.detector = detector

    if recognizer is None:
        _require_model(FACE_RECOGNIZER_MODEL)
        recognizer = cv2.FaceRecognizerSF.create(str(FACE_RECOGNIZER_MODEL), "")
        _tls.recognizer = recognizer

    return detector, recognizer


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
    """Detect faces on a bounded-size copy, returning original-image coordinates."""
    detector, _ = get_models()
    height, width = image.shape[:2]
    scale = min(1.0, FACE_DETECTION_MAX_SIDE / max(height, width))

    if scale < 1.0:
        detect_image = cv2.resize(
            image,
            (max(1, int(width * scale)), max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    else:
        detect_image = image

    detect_h, detect_w = detect_image.shape[:2]
    detector.setInputSize((detect_w, detect_h))
    _, faces = detector.detect(detect_image)
    if faces is None:
        return np.zeros((0, 15), dtype=np.float32)

    faces = np.asarray(faces, dtype=np.float32)
    if scale < 1.0:
        # Columns 0..13 are bbox x/y/w/h plus 5 landmark points; column 14 is score.
        faces[:, 0:14] /= scale
    return faces


def extract_query_embedding(image: np.ndarray) -> tuple[np.ndarray, int]:
    """Return (normalized embedding, detected face count).

    Raises NoFaceDetected instead of inventing an embedding from a non-face
    image; otherwise a dark/empty camera frame silently yields zero matches.
    """
    faces = detect_faces(image)
    if len(faces) == 0:
        raise NoFaceDetected("No face detected in the scan frame")

    usable = faces[faces[:, -1] >= FACE_QUERY_SCORE_THRESHOLD]
    if len(usable) == 0:
        raise NoFaceDetected("No face above the detection confidence threshold")

    best_face = usable[np.argmax(usable[:, -1])]
    _, recognizer = get_models()
    aligned = recognizer.alignCrop(image, best_face)
    feature = recognizer.feature(aligned)
    return _normalize_feature(feature), len(usable)


def extract_photo_embeddings(image: np.ndarray) -> List[Dict[str, object]]:
    faces = detect_faces(image)
    # The detector is created with the lower query threshold; enrollment keeps
    # the stricter album quality gate.
    faces = faces[faces[:, -1] >= FACE_DETECTION_SCORE_THRESHOLD]
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
    try:
        blank = np.zeros(
            (FACE_QUERY_FALLBACK_SIZE, FACE_QUERY_FALLBACK_SIZE, 3),
            dtype=np.uint8,
        )
        extract_query_embedding(blank)
    except NoFaceDetected:
        # Loading/running the models is the point of warmup; a blank frame
        # correctly has no face.
        pass

