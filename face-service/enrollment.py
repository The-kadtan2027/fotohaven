# face-service/enrollment.py
import numpy as np
from PIL import Image
from pathlib import Path
from typing import Callable, Optional
import os
from mtcnn import MTCNN
from inference import get_embedding
from db import save_embedding, delete_event_embeddings, get_all_photo_paths

# MTCNN is stateless — one instance, reused across calls
_detector = MTCNN()

# Root path where photo files are stored on disk
_PHOTO_ROOT = Path(os.environ.get(
    "LOCAL_UPLOAD_PATH",
    "/data/data/com.termux/files/home/storage/shared/fotohaven"
))


def _align_face(img: np.ndarray, keypoints: dict, size: int = 112) -> np.ndarray:
    """
    Align face using eye landmarks for consistent crop.
    Returns (size, size, 3) float32 array with values in [-1, 1].
    """
    from PIL import Image as PILImage
    import math

    left_eye  = keypoints['left_eye']
    right_eye = keypoints['right_eye']

    # Compute rotation angle
    dx = right_eye[0] - left_eye[0]
    dy = right_eye[1] - left_eye[1]
    angle = math.degrees(math.atan2(dy, dx))

    # Center between eyes
    eye_center = (
        (left_eye[0] + right_eye[0]) / 2,
        (left_eye[1] + right_eye[1]) / 2,
    )

    pil = PILImage.fromarray(img)
    rotated = pil.rotate(-angle, center=eye_center, expand=False)

    # Crop around eye center with padding
    eye_dist = math.sqrt(dx**2 + dy**2)
    pad = eye_dist * 1.8
    box = (
        eye_center[0] - pad,
        eye_center[1] - pad * 1.1,
        eye_center[0] + pad,
        eye_center[1] + pad * 0.9,
    )
    # Clamp to image bounds
    w, h = pil.size
    box = (
        max(0, box[0]), max(0, box[1]),
        min(w, box[2]), min(h, box[3])
    )
    cropped = rotated.crop(box).resize((size, size), PILImage.LANCZOS)

    # Normalize to [-1, 1]
    arr = np.array(cropped, dtype=np.float32) / 127.5 - 1.0
    return arr


def enroll_event(
    event_id: str,
    photo_root: Optional[Path] = None,
    progress_cb: Optional[Callable[[int, int], None]] = None
) -> dict:
    """
    Process all photos for an event and store face embeddings.

    Args:
        event_id: str
        photo_root: override base path for photo files (default: _PHOTO_ROOT)
        progress_cb: optional callback(current, total) for progress reporting

    Returns:
        { "processed": int, "faces_found": int, "errors": int }
    """
    root = photo_root or _PHOTO_ROOT

    # 1. Clear existing embeddings for this event (re-enrollment)
    delete_event_embeddings(event_id)

    # 2. Fetch all photo paths for this event
    photo_rows = get_all_photo_paths(event_id)
    total = len(photo_rows)

    processed = 0
    faces_found = 0
    errors = 0

    for i, (photo_id, file_path) in enumerate(photo_rows):
        if progress_cb:
            progress_cb(i, total)

        # Resolve absolute path
        abs_path = root / file_path if not Path(file_path).is_absolute() else Path(file_path)

        try:
            # Load image
            img = np.array(Image.open(abs_path).convert("RGB"))

            # Detect all faces
            detections = _detector.detect_faces(img)

            for face_idx, det in enumerate(detections):
                confidence = det['confidence']
                if confidence < 0.90:
                    continue  # Skip low-confidence detections

                keypoints = det['keypoints']
                aligned   = _align_face(img, keypoints, size=112)
                embedding = get_embedding(aligned)

                bbox = tuple(float(v) for v in det['box'])  # (x, y, w, h)
                save_embedding(event_id, photo_id, face_idx, embedding, bbox)
                faces_found += 1

            processed += 1

        except Exception as e:
            errors += 1
            print(f"[enroll] Error on {file_path}: {e}")
            continue

    return {
        "processed": processed,
        "faces_found": faces_found,
        "errors": errors,
        "total": total,
    }
