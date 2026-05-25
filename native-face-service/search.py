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

    embeddings: List[np.ndarray] = []
    photo_ids: List[str] = []
    face_indices: List[int] = []

    for photo_id, face_index, emb_bytes in rows:
        embeddings.append(np.frombuffer(emb_bytes, dtype=np.float32).copy())
        photo_ids.append(photo_id)
        face_indices.append(face_index)

    matrix = np.stack(embeddings, axis=0)

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
    high_threshold: float = 0.70,
    low_threshold: float = 0.55,
) -> Dict[str, List[str]]:
    with _lock:
        index = _store.get(event_id)

    if index is None or index.size() == 0:
        return {"definite": [], "possible": []}

    similarities = index.matrix @ query_embedding
    order = np.argsort(similarities)[::-1]

    definite_ids: List[str] = []
    possible_ids: List[str] = []
    seen = set()

    for i in order:
        score = float(similarities[i])
        photo_id = index.photo_ids[i]
        if photo_id in seen:
            continue

        if score >= high_threshold:
            definite_ids.append(photo_id)
            seen.add(photo_id)
        elif score >= low_threshold:
            possible_ids.append(photo_id)
            seen.add(photo_id)

    return {"definite": definite_ids, "possible": possible_ids}


def unload_event(event_id: str) -> None:
    with _lock:
        _store.pop(event_id, None)


def index_stats() -> Dict[str, int]:
    with _lock:
        return {event_id: index.size() for event_id, index in _store.items()}

