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

# Detection runs on a downscaled copy only when the source is larger than this.
# 2048 preserves existing 2048px thumbnails/embeddings exactly; lowering to
# 1600 is ~30% faster but drifts old-vs-new embeddings (avg cosine 0.92).
FACE_DETECTION_MAX_SIDE = max(
    640, min(4096, _read_int("FACE_DETECTION_MAX_SIDE", 2048))
)

# Benchmarked on the 8-core phone: one worker with 8 OpenCV threads is faster
# than two competing workers, and uses one model copy (~50 MB) instead of two.
OPENCV_NUM_THREADS = max(1, min(8, _read_int("OPENCV_NUM_THREADS", 8)))

# Cap the number of returned matches per tier to keep responses small on huge albums.
SEARCH_MAX_RESULTS = max(1, min(5000, _read_int("SEARCH_MAX_RESULTS", 500)))

# Number of parallel threads for face enrollment.
# Each thread loads its own model (~50 MB), so keep this low on memory-constrained devices.
# Set via env var ENROLL_WORKERS; defaults to 2.
import os as _os
ENROLL_WORKERS = max(1, min(
    _read_int("ENROLL_WORKERS", 1),
    _os.cpu_count() or 1,
))

