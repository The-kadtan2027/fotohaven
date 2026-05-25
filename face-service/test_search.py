import sys
import numpy as np

from db import get_all_event_embeddings
from search import load_event, search


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python test_search.py <event_id>")
        return 1

    event_id = sys.argv[1]
    rows = get_all_event_embeddings(event_id)
    if not rows:
        print("No embeddings found for event:", event_id)
        return 1

    load_event(event_id, rows)
    print(f"Loaded {len(rows)} embeddings")

    photo_id_0, _, emb_bytes_0 = rows[0]
    query = np.frombuffer(emb_bytes_0, dtype=np.float32).copy()
    result = search(event_id, query, high_threshold=0.70, low_threshold=0.55)

    print("Query photo:", photo_id_0)
    print("Definite:", result["definite"][:5])
    print("Possible:", result["possible"][:5])

    assert photo_id_0 in result["definite"], "FAIL: own photo not in definite matches"
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
