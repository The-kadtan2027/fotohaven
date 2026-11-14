from __future__ import annotations

import sqlite3
from typing import Iterable, List, Optional, Tuple

import numpy as np

from config import DATABASE_PATH

# Indexes that make enrollment and search scale on large albums. They are
# additive and safe to create on every service start.
_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_face_embeddings_event "
    "ON face_embeddings(event_id, photo_id)",
    "CREATE INDEX IF NOT EXISTS idx_face_embeddings_photo "
    "ON face_embeddings(photo_id, event_id)",
    "CREATE INDEX IF NOT EXISTS idx_photo_ceremony_processed "
    "ON Photo(ceremonyId, isReturn, faceProcessed)",
    "CREATE INDEX IF NOT EXISTS idx_ceremony_album "
    "ON Ceremony(albumId)",
)


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(DATABASE_PATH, timeout=30)
    con.execute("PRAGMA busy_timeout=10000")
    con.execute("PRAGMA synchronous=NORMAL")
    con.execute("PRAGMA cache_size=-8000")
    con.execute("PRAGMA temp_store=MEMORY")
    con.execute("PRAGMA mmap_size=268435456")
    return con


def _ensure_indexes() -> None:
    try:
        with _conn() as con:
            con.execute("PRAGMA journal_mode=WAL")
            for statement in _INDEXES:
                con.execute(statement)
    except sqlite3.Error as exc:
        # The service should still start if the app has not created the tables yet.
        print(f"[native-db] index setup skipped: {exc}")


_ensure_indexes()


def get_all_event_embeddings(event_id: str) -> List[Tuple[str, int, bytes]]:
    with _conn() as con:
        return con.execute(
            "SELECT photo_id, face_index, embedding FROM face_embeddings WHERE event_id = ?",
            (event_id,),
        ).fetchall()


def get_photo_embeddings(event_id: str, photo_ids: List[str]) -> List[bytes]:
    """Return embeddings for photo ids that belong to the requested event only."""
    if not photo_ids:
        return []
    placeholders = ",".join("?" for _ in photo_ids)
    with _conn() as con:
        rows = con.execute(
            f"SELECT embedding FROM face_embeddings "
            f"WHERE event_id = ? AND photo_id IN ({placeholders})",
            (event_id, *photo_ids),
        ).fetchall()
    return [r[0] for r in rows]


def save_photo_faces(event_id: str, photo_id: str, faces: Iterable[dict]) -> int:
    """Insert all faces for one photo and mark it processed in one transaction."""
    rows = []
    for item in faces:
        bbox = item["bounding_box"]
        rows.append(
            (
                event_id,
                photo_id,
                int(item["face_index"]),
                np.asarray(item["embedding"], dtype=np.float32).tobytes(),
                float(bbox["x"]),
                float(bbox["y"]),
                float(bbox["width"]),
                float(bbox["height"]),
            )
        )

    with _conn() as con:
        if rows:
            con.executemany(
                """
                INSERT INTO face_embeddings
                  (event_id, photo_id, face_index, embedding, bbox_x, bbox_y, bbox_w, bbox_h)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
        con.execute("UPDATE Photo SET faceProcessed = 1 WHERE id = ?", (photo_id,))

    return len(rows)


def delete_event_embeddings(event_id: str) -> None:
    with _conn() as con:
        con.execute("DELETE FROM face_embeddings WHERE event_id = ?", (event_id,))


def mark_photo_processed(photo_id: str) -> None:
    with _conn() as con:
        con.execute("UPDATE Photo SET faceProcessed = 1 WHERE id = ?", (photo_id,))


def get_all_photo_paths(event_id: str) -> List[Tuple[str, str]]:
    with _conn() as con:
        return con.execute(
            """
            SELECT p.id, p.storageKey
            FROM Photo p
            INNER JOIN Ceremony c ON p.ceremonyId = c.id
            WHERE c.albumId = ? AND p.isReturn = 0 AND p.faceProcessed = 0
            """,
            (event_id,),
        ).fetchall()


def get_event_thresholds(event_id: str) -> Tuple[float, float]:
    with _conn() as con:
        row = con.execute(
            "SELECT high_threshold, low_threshold FROM Album WHERE id = ?",
            (event_id,),
        ).fetchone()

    if row and row[0] is not None and row[1] is not None:
        return float(row[0]), float(row[1])
    return 0.70, 0.55
