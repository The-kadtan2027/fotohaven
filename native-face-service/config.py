from __future__ import annotations

import os
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parent


def _read_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _read_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _resolve_path(name: str, default: str) -> Path:
    raw = os.environ.get(name, default)
    path = Path(raw)
    if not path.is_absolute():
        path = SERVICE_ROOT / path
    return path.resolve()


FACE_LOCAL_SERVICE_BIND = os.environ.get("FACE_LOCAL_SERVICE_BIND", "127.0.0.1")
FACE_LOCAL_SERVICE_PORT = _read_int("FACE_LOCAL_SERVICE_PORT", 5080)

DATABASE_PATH = os.environ.get("DB_PATH") or os.environ.get("DATABASE_URL", "")
if DATABASE_PATH.startswith("file:"):
    DATABASE_PATH = DATABASE_PATH.removeprefix("file:")
if not DATABASE_PATH:
    candidate = SERVICE_ROOT.parent / "local.db"
    DATABASE_PATH = str(candidate if candidate.exists() else SERVICE_ROOT.parent / "dev.db")

LOCAL_UPLOAD_PATH = Path(
    os.environ.get(
        "LOCAL_UPLOAD_PATH",
        "/data/data/com.termux/files/home/storage/shared/fotohaven",
    )
).resolve()

FACE_DETECTOR_MODEL = _resolve_path(
    "FACE_DETECTOR_MODEL",
    "./models/face_detection_yunet_2023mar.onnx",
)
FACE_RECOGNIZER_MODEL = _resolve_path(
    "FACE_RECOGNIZER_MODEL",
    "./models/face_recognition_sface_2021dec.onnx",
)

FACE_DETECTION_SCORE_THRESHOLD = _read_float("FACE_DETECTION_SCORE_THRESHOLD", 0.9)
FACE_DETECTION_NMS_THRESHOLD = _read_float("FACE_DETECTION_NMS_THRESHOLD", 0.3)
FACE_DETECTION_TOP_K = _read_int("FACE_DETECTION_TOP_K", 5000)
FACE_QUERY_FALLBACK_SIZE = _read_int("FACE_QUERY_FALLBACK_SIZE", 112)

