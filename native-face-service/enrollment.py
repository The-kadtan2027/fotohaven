from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable, Optional

import cv2

from config import ENROLL_WORKERS, LOCAL_UPLOAD_PATH
from db import delete_event_embeddings, get_all_photo_paths, save_embedding, mark_photo_processed
from opencv_backend import extract_photo_embeddings


def _process_single_photo(
    event_id: str,
    photo_id: str,
    storage_key: str,
    root: Path,
) -> int:
    """Process one photo: detect faces, extract embeddings, save to DB.

    Returns the number of faces found.
    """
    photo_path = Path(storage_key)
    if not photo_path.is_absolute():
        photo_path = root / storage_key

    image = cv2.imread(str(photo_path))
    if image is None:
        raise ValueError(f"Could not load image: {photo_path}")

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

    mark_photo_processed(photo_id)
    return len(embeddings)


def enroll_event(
    event_id: str,
    photo_root: Optional[Path] = None,
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> dict:
    root = photo_root or LOCAL_UPLOAD_PATH

    photo_rows = get_all_photo_paths(event_id)
    total = len(photo_rows)
    if total == 0:
        return {"processed": 0, "faces_found": 0, "errors": 0, "total": 0}

    processed = 0
    faces_found = 0
    errors = 0
    counter_lock = threading.Lock()

    workers = min(ENROLL_WORKERS, total)
    print(f"[native-enroll] Starting enrollment: {total} photos, {workers} worker(s)")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_photo = {
            pool.submit(
                _process_single_photo, event_id, photo_id, storage_key, root
            ): (photo_id, storage_key)
            for photo_id, storage_key in photo_rows
        }

        for future in as_completed(future_to_photo):
            photo_id, storage_key = future_to_photo[future]

            with counter_lock:
                try:
                    count = future.result()
                    processed += 1
                    faces_found += count
                except Exception as exc:
                    errors += 1
                    print(f"[native-enroll] Failed {storage_key}: {exc}")

                done = processed + errors
                if progress_cb:
                    progress_cb(done, total)

    print(
        f"[native-enroll] Done: {processed}/{total} processed, "
        f"{faces_found} faces, {errors} errors"
    )

    return {
        "processed": processed,
        "faces_found": faces_found,
        "errors": errors,
        "total": total,
    }
