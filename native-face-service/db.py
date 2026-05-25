from __future__ import annotations

import sqlite3
from typing import List, Optional, Tuple

import numpy as np

from config import DATABASE_PATH


def _conn() -> sqlite3.Connection:
    return sqlite3.connect(DATABASE_PATH)


def get_all_event_embeddings(event_id: str) -> List[Tuple[str, int, bytes]]:
    with _conn() as con:
        return con.execute(
            "SELECT photo_id, face_index, embedding FROM face_embeddings WHERE event_id = ?",
            (event_id,),
        ).fetchall()


def save_embedding(
    event_id: str,
    photo_id: str,
    face_index: int,
    embedding: np.ndarray,
    bbox: Optional[Tuple[float, float, float, float]] = None,
) -> None:
    emb_bytes = embedding.astype(np.float32).tobytes()
    bbox_vals = bbox if bbox else (None, None, None, None)

    with _conn() as con:
        con.execute(
            """
            INSERT INTO face_embeddings
              (event_id, photo_id, face_index, embedding, bbox_x, bbox_y, bbox_w, bbox_h)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (event_id, photo_id, face_index, emb_bytes, *bbox_vals),
        )


def delete_event_embeddings(event_id: str) -> None:
    with _conn() as con:
        con.execute("DELETE FROM face_embeddings WHERE event_id = ?", (event_id,))


def get_all_photo_paths(event_id: str) -> List[Tuple[str, str]]:
    with _conn() as con:
        return con.execute(
            """
            SELECT p.id, p.storageKey
            FROM Photo p
            INNER JOIN Ceremony c ON p.ceremonyId = c.id
            WHERE c.albumId = ? AND p.isReturn = 0
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

