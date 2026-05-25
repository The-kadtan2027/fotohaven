from __future__ import annotations

from pathlib import Path
from typing import Callable, Optional

import cv2

from config import LOCAL_UPLOAD_PATH
from db import delete_event_embeddings, get_all_photo_paths, save_embedding
from opencv_backend import extract_photo_embeddings


def enroll_event(
    event_id: str,
    photo_root: Optional[Path] = None,
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> dict:
    root = photo_root or LOCAL_UPLOAD_PATH
    delete_event_embeddings(event_id)

    photo_rows = get_all_photo_paths(event_id)
    total = len(photo_rows)
    processed = 0
    faces_found = 0
    errors = 0

    for index, (photo_id, storage_key) in enumerate(photo_rows, start=1):
        if progress_cb:
            progress_cb(index, total)

        photo_path = Path(storage_key)
        if not photo_path.is_absolute():
            photo_path = root / storage_key

        try:
            image = cv2.imread(str(photo_path))
            if image is None:
                raise ValueError("Could not load image")

            embeddings = extract_photo_embeddings(image)
            for item in embeddings:
                bbox = item["bounding_box"]
                save_embedding(
                    event_id,
                    photo_id,
                    int(item["face_index"]),
                    item["embedding"],
                    (
                        float(bbox["x"]),
                        float(bbox["y"]),
                        float(bbox["width"]),
                        float(bbox["height"]),
                    ),
                )
                faces_found += 1

            processed += 1
        except Exception as exc:
            errors += 1
            print(f"[native-enroll] Failed {photo_path}: {exc}")

    return {
        "processed": processed,
        "faces_found": faces_found,
        "errors": errors,
        "total": total,
    }

