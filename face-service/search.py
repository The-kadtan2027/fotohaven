# face-service/search.py
import numpy as np
from dataclasses import dataclass
from typing import Dict, List, Tuple
import threading

@dataclass
class EmbeddingIndex:
    matrix: np.ndarray          # shape [N, D], float32, L2-normalized
    photo_ids: List[str]        # parallel array — index → photo_id
    face_indices: List[int]     # parallel array — index → face_index in photo

    def size(self) -> int:
        return len(self.photo_ids)


# Global store: event_id → EmbeddingIndex
# Protected by a read-write lock (writes are rare; reads are frequent)
_store: Dict[str, EmbeddingIndex] = {}
_lock = threading.RLock()


def load_event(event_id: str, rows: List[Tuple[str, int, bytes]]) -> int:
    """
    Load embeddings for an event from raw DB rows into RAM using single-pass batch deserialization.

    Args:
        event_id: str
        rows: list of (photo_id, face_index, embedding_bytes)
              embedding_bytes = D × float32

    Returns:
        Number of embeddings loaded
    """
    if not rows:
        with _lock:
            _store[event_id] = EmbeddingIndex(
                matrix=np.zeros((0, 192), dtype=np.float32),
                photo_ids=[],
                face_indices=[]
            )
        return 0

    photo_ids = [r[0] for r in rows]
    face_idxs = [r[1] for r in rows]

    # Vectorized single-pass byte buffer concatenation + zero-copy NumPy reshape
    all_bytes = b"".join(r[2] for r in rows)
    matrix = np.frombuffer(all_bytes, dtype=np.float32).reshape(len(rows), -1)

    with _lock:
        _store[event_id] = EmbeddingIndex(
            matrix=matrix,
            photo_ids=photo_ids,
            face_indices=face_idxs
        )

    return len(rows)


def search(
    event_id: str,
    query_embedding: np.ndarray,
    high_threshold: float = 0.70,
    low_threshold: float  = 0.55,
) -> Dict[str, List[str]]:
    """
    Find photos matching the query embedding within an event.

    Args:
        event_id: str
        query_embedding: np.ndarray (D,), L2-normalized
        high_threshold: cosine similarity cutoff for "definite" matches
        low_threshold:  cosine similarity cutoff for "possible" matches

    Returns:
        {
          "definite": [photo_id, ...],   # sim >= high_threshold, deduped
          "possible": [photo_id, ...],   # low_threshold <= sim < high_threshold, deduped
        }
    """
    with _lock:
        index = _store.get(event_id)

    if index is None or index.size() == 0:
        return {"definite": [], "possible": []}

    # Vectorized matrix-vector multiplication via BLAS/SIMD — O(N)
    similarities = index.matrix @ query_embedding  # (N,)

    definite_ids: List[str] = []
    possible_ids: List[str] = []
    seen = set()

    # Sort by similarity descending so best match per photo wins dedup
    order = np.argsort(similarities)[::-1]

    for i in order:
        sim = float(similarities[i])
        pid = index.photo_ids[i]

        if sim >= high_threshold:
            if pid not in seen:
                definite_ids.append(pid)
                seen.add(pid)
        elif sim >= low_threshold:
            if pid not in seen:
                possible_ids.append(pid)
                seen.add(pid)

    return {"definite": definite_ids, "possible": possible_ids}


def unload_event(event_id: str):
    """Free RAM for an event (call when event is archived)."""
    with _lock:
        _store.pop(event_id, None)


def index_stats() -> Dict[str, int]:
    """Return count of loaded embeddings per event (for health endpoint)."""
    with _lock:
        return {eid: idx.size() for eid, idx in _store.items()}
