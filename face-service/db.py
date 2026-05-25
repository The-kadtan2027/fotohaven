# face-service/db.py
import sqlite3
import numpy as np
from typing import List, Tuple, Optional
from pathlib import Path
import os

def _resolve_db_path() -> str:
    db_path = os.environ.get("DB_PATH")
    if db_path:
        return db_path

    database_url = os.environ.get("DATABASE_URL")
    if database_url and database_url.startswith("file:"):
        return database_url.removeprefix("file:")

    repo_root = Path(__file__).parent.parent
    local_db = repo_root / "local.db"
    if local_db.exists():
        return str(local_db)

    return str(repo_root / "dev.db")


_DB_PATH = _resolve_db_path()


def _conn() -> sqlite3.Connection:
    """Open a new connection. Called per request — SQLite handles concurrency."""
    return sqlite3.connect(_DB_PATH)


def get_all_event_embeddings(event_id: str) -> List[Tuple[str, int, bytes]]:
    """
    Fetch all face embeddings for an event.
    Returns list of (photo_id, face_index, embedding_bytes).
    """
    with _conn() as con:
        rows = con.execute(
            "SELECT photo_id, face_index, embedding FROM face_embeddings WHERE event_id = ?",
            (event_id,)
        ).fetchall()
    return rows


def save_embedding(
    event_id: str,
    photo_id: str,
    face_index: int,
    embedding: np.ndarray,
    bbox: Optional[Tuple[float, float, float, float]] = None
):
    """
    Upsert a single face embedding.
    bbox = (x, y, w, h) in pixels, optional.
    """
    emb_bytes = embedding.astype(np.float32).tobytes()
    bbox_vals = bbox if bbox else (None, None, None, None)

    with _conn() as con:
        con.execute("""
            INSERT INTO face_embeddings
                (event_id, photo_id, face_index, embedding, bbox_x, bbox_y, bbox_w, bbox_h)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (event_id, photo_id, face_index, emb_bytes, *bbox_vals))


def delete_event_embeddings(event_id: str):
    """Clear all embeddings for an event (before re-enrollment)."""
    with _conn() as con:
        con.execute(
            "DELETE FROM face_embeddings WHERE event_id = ?",
            (event_id,)
        )


def get_all_photo_paths(event_id: str) -> List[Tuple[str, str]]:
    """
    Fetch all photo IDs + storageKeys (files) for an event.
    Returns list of (photo_id, storageKey).
    """
    with _conn() as con:
        rows = con.execute("""
            SELECT p.id, p.storageKey
            FROM Photo p
            INNER JOIN Ceremony c ON p.ceremonyId = c.id
            WHERE c.albumId = ? AND p.isReturn = 0
        """, (event_id,)).fetchall()
    return rows


def get_event_thresholds(event_id: str) -> Tuple[float, float]:
    """
    Returns (high_threshold, low_threshold) for an event.
    Defaults to (0.70, 0.55) if not configured.
    """
    with _conn() as con:
        row = con.execute(
            "SELECT high_threshold, low_threshold FROM Album WHERE id = ?",
            (event_id,)
        ).fetchone()

    if row and row[0] is not None:
        return float(row[0]), float(row[1])
    return 0.70, 0.55
