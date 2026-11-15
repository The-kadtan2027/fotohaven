from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np


@dataclass
class EmbeddingIndex:
    matrix: np.ndarray
    photo_ids: List[str]
    face_indices: List[int]

    def size(self) -> int:
        return len(self.photo_ids)


_store: Dict[str, EmbeddingIndex] = {}
_lock = threading.RLock()


def load_event(event_id: str, rows: List[Tuple[str, int, bytes]]) -> int:
    if not rows:
        with _lock:
            _store[event_id] = EmbeddingIndex(
                matrix=np.zeros((0, 128), dtype=np.float32),
                photo_ids=[],
                face_indices=[],
            )
        return 0

    photo_ids = [r[0] for r in rows]
    face_indices = [r[1] for r in rows]

    # Vectorized single-pass byte buffer concatenation + zero-copy NumPy reshape
    all_bytes = b"".join(r[2] for r in rows)
    matrix = np.frombuffer(all_bytes, dtype=np.float32).reshape(len(rows), -1)

    with _lock:
        _store[event_id] = EmbeddingIndex(
            matrix=matrix,
            photo_ids=photo_ids,
            face_indices=face_indices,
        )

    return len(rows)


def search(
    event_id: str,
    query_embedding: np.ndarray,
    high_threshold: float = 0.68,
    low_threshold: float = 0.55,
    max_results: int = 500,
) -> Dict[str, List[dict]]:
    with _lock:
        index = _store.get(event_id)

    if index is None or index.size() == 0:
        return {
            "definite": [],
            "possible": [],
            "best_score": None,
            "indexed_faces": 0,
        }

    similarities = index.matrix @ query_embedding
    best_score = float(np.max(similarities)) if len(similarities) else None
    order = np.argsort(similarities)[::-1]

    definite: List[dict] = []
    possible: List[dict] = []
    seen = set()

    for i in order:
        score = float(similarities[i])
        photo_id = index.photo_ids[i]
        if photo_id in seen:
            continue

        item = {"photo_id": photo_id, "score": round(score, 4)}
        if score >= high_threshold:
            definite.append(item)
            seen.add(photo_id)
        elif score >= low_threshold:
            possible.append(item)
            seen.add(photo_id)

        if len(definite) >= max_results and len(possible) >= max_results:
            break

    return {
        "definite": definite[:max_results],
        "possible": possible[:max_results],
        "best_score": round(best_score, 4) if best_score is not None else None,
        "indexed_faces": index.size(),
    }


def unload_event(event_id: str) -> None:
    with _lock:
        _store.pop(event_id, None)


def index_stats() -> Dict[str, int]:
    with _lock:
        return {event_id: index.size() for event_id, index in _store.items()}
