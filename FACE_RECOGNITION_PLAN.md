# FotoHaven — Face Recognition Feature
# Implementation Plan

> **Status correction (2026-05-26):** This document reflects an older Python/TFLite implementation direction. For current Termux-native on-device work, the validated install path is `apt` from the `termux-x11` repo with `opencv 4.13.0-2` and `opencv-python 4.13.0-2`, not the default `pkg` path. `cv2.dnn`, `FaceDetectorYN`, and `FaceRecognizerSF` are available in that build. Use [native-face-service/README.md](/D:/antigravity/files/fotohaven/native-face-service/README.md) and [docs/superpowers/plans/2026-05-25-termux-native-face-http.md](/D:/antigravity/files/fotohaven/docs/superpowers/plans/2026-05-25-termux-native-face-http.md) as the authoritative Termux-native reference.
>
> **For agentic workers:** Read this entire document before touching any file.
> Use `executing-plans` skill to implement task-by-task using the checkboxes below.
> Every task is self-contained. Do not skip ahead.

**Goal:** Add server-side face recognition to FotoHaven so that after OTP authentication,
a guest can scan their face and instantly filter the event album to photos containing them.

**Architecture:** A Python FastAPI microservice (`face-service/`) runs alongside Next.js
via PM2 on port 5001. The browser uses MediaPipe WASM for face detection and alignment,
sends a 112×112 cropped JPEG to Next.js, which proxies it to the face service. The face
service runs MobileFaceNet TFLite inference and searches a per-event in-memory embedding
matrix via cosine similarity, returning tiered results (definite + possible matches).

**Tech Stack:**
- Browser: MediaPipe FaceMesh (WASM, CDN)
- Python service: FastAPI, uvicorn, tflite-runtime, mtcnn (TFLite), numpy, Pillow
- Database: existing SQLite via Drizzle ORM (new `face_embeddings` table)
- Process manager: existing PM2 ecosystem.config.js
- Language: Python 3.11 (Termux), TypeScript (Next.js)

---

## Assumptions About Existing Codebase

The agent MUST verify these before starting. If any differ, adapt accordingly.

```
fotohaven/
├── app/                        # Next.js app router
│   ├── api/                    # API routes
│   ├── (photographer)/         # Photographer dashboard pages
│   └── (guest)/                # Guest-facing pages
├── lib/
│   ├── db.ts                   # Drizzle ORM instance + SQLite connection
│   └── schema.ts               # Drizzle schema (events, photos, clients tables)
├── components/                 # React components
├── ecosystem.config.js         # PM2 config (Next.js process already here)
├── package.json
└── fotohaven.db                # SQLite database file
```

**Verify before starting:**
- [ ] Run `ls` in project root to confirm structure above
- [ ] Run `cat lib/schema.ts` to see existing table names and column names
- [ ] Run `cat ecosystem.config.js` to see existing PM2 config format
- [ ] Run `cat lib/db.ts` to see how Drizzle is instantiated
- [ ] Note the exact path to `fotohaven.db` (used by face service)

---

## File Map — Everything That Will Be Created or Modified

### New Files
```
face-service/
├── main.py                     # FastAPI app, routes, startup
├── inference.py                # TFLite model loading + embedding extraction
├── search.py                   # In-memory index + cosine similarity search
├── enrollment.py               # MTCNN detection + batch photo processing
├── db.py                       # SQLite read/write for embeddings
├── models/
│   └── .gitkeep               # MobileFaceNet .tflite file goes here (downloaded at setup)
├── requirements.txt
└── setup.sh                    # Termux install script

app/api/recognize/
└── route.ts                    # POST /api/recognize — proxy to face service

app/api/admin/enroll/[eventId]/
└── route.ts                    # POST trigger enrollment, GET status

app/api/admin/events/[id]/thresholds/
└── route.ts                    # PATCH update threshold config

components/face-scanner/
├── FaceScanner.tsx             # Camera modal with MediaPipe
└── FaceScanResults.tsx         # Tiered results display (definite + possible)
```

### Modified Files
```
lib/schema.ts                   # Add face_embeddings table + threshold cols to events
lib/db.ts                       # No change expected — verify only
ecosystem.config.js             # Add face-service process
app/(guest)/event/[id]/page.tsx # Add "Find My Photos" button + FaceScanner modal
```

---

## Task 1: Database Schema — face_embeddings Table

**Files:**
- Modify: `lib/schema.ts`
- Create: `drizzle/migrations/XXXX_add_face_embeddings.sql` (agent generates via drizzle-kit)

### What to add

Open `lib/schema.ts`. Add the following after existing table definitions.

```typescript
// Add to existing imports at top if not present
import { sqliteTable, integer, text, real, blob } from 'drizzle-orm/sqlite-core'

export const faceEmbeddings = sqliteTable('face_embeddings', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  eventId:     text('event_id').notNull(),
  photoId:     text('photo_id').notNull(),
  faceIndex:   integer('face_index').notNull(),   // 0-based, multiple faces per photo
  embedding:   blob('embedding', { mode: 'buffer' }).notNull(), // 512 × float32 = 2048 bytes
  bboxX:       real('bbox_x'),
  bboxY:       real('bbox_y'),
  bboxW:       real('bbox_w'),
  bboxH:       real('bbox_h'),
  createdAt:   integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})
```

Also add threshold columns to the existing `events` table. Find the events table definition and add:

```typescript
// Inside existing events table definition — add these two columns:
highThreshold: real('high_threshold').default(0.70),
lowThreshold:  real('low_threshold').default(0.55),
```

- [ ] **Step 1: Open `lib/schema.ts` and read current content**
- [ ] **Step 2: Add `faceEmbeddings` table definition as shown above**
- [ ] **Step 3: Add `highThreshold` and `lowThreshold` to existing events table**
- [ ] **Step 4: Generate migration**
  ```bash
  npx drizzle-kit generate
  ```
  Expected: new file in `drizzle/migrations/` with the two ALTER/CREATE statements
- [ ] **Step 5: Apply migration**
  ```bash
  npx drizzle-kit migrate
  ```
  Expected: `face_embeddings` table created, two columns added to events
- [ ] **Step 6: Verify**
  ```bash
  sqlite3 fotohaven.db ".schema face_embeddings"
  ```
  Expected: shows CREATE TABLE with all 9 columns
- [ ] **Step 7: Commit**
  ```bash
  git add lib/schema.ts drizzle/migrations/
  git commit -m "feat: add face_embeddings schema + threshold config on events"
  ```

---

## Task 2: Python Face Service — Project Setup

**Files:**
- Create: `face-service/requirements.txt`
- Create: `face-service/setup.sh`
- Create: `face-service/models/.gitkeep`

### requirements.txt

```text
fastapi==0.111.0
uvicorn==0.29.0
numpy==1.26.4
Pillow==10.3.0
tflite-runtime==2.14.0
mtcnn==0.1.1
```

> **Termux note:** `tflite-runtime` ARM64 wheel for Python 3.11 is at:
> https://github.com/prepkg/tflite-runtime-raspberrypi/releases
> If `pip install tflite-runtime` fails, see setup.sh for the manual wheel install.

### setup.sh

```bash
#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=== FotoHaven Face Service Setup ==="

# 1. System packages
pkg install -y python python-pip

# 2. pip packages
pip install fastapi==0.111.0 uvicorn==0.29.0 numpy==1.26.4 Pillow==10.3.0 mtcnn==0.1.1

# 3. tflite-runtime — try official first, fall back to ARM64 wheel
pip install tflite-runtime==2.14.0 || {
  echo "Official wheel failed, trying ARM64 community wheel..."
  # Python 3.11 ARM64 wheel
  pip install \
    https://github.com/prepkg/tflite-runtime-raspberrypi/releases/download/2.14.0/tflite_runtime-2.14.0-cp311-cp311-linux_aarch64.whl
}

# 4. Download MobileFaceNet TFLite model
mkdir -p models
if [ ! -f models/mobilefacenet.tflite ]; then
  echo "Downloading MobileFaceNet model..."
  curl -L \
    "https://github.com/sirius-ai/MobileFaceNet_TF/raw/master/output/MobileFaceNet.tflite" \
    -o models/mobilefacenet.tflite
  echo "Model downloaded: $(du -sh models/mobilefacenet.tflite | cut -f1)"
fi

echo "=== Setup complete. Run: uvicorn main:app --host 127.0.0.1 --port 5001 ==="
```

- [ ] **Step 1: Create `face-service/` directory**
  ```bash
  mkdir -p face-service/models
  ```
- [ ] **Step 2: Create `face-service/requirements.txt` with content above**
- [ ] **Step 3: Create `face-service/setup.sh` with content above**
- [ ] **Step 4: Create `face-service/models/.gitkeep`**
  ```bash
  touch face-service/models/.gitkeep
  ```
- [ ] **Step 5: Run setup on the Termux device**
  ```bash
  cd face-service && bash setup.sh
  ```
  Expected: all packages installed, `models/mobilefacenet.tflite` exists (~4MB)
- [ ] **Step 6: Commit**
  ```bash
  git add face-service/
  git commit -m "feat: face-service scaffold + setup script"
  ```

---

## Task 3: Python Face Service — Inference Module

**Files:**
- Create: `face-service/inference.py`

This module loads the MobileFaceNet TFLite model once at import time and exposes
a single function: `get_embedding(face_112: np.ndarray) -> np.ndarray`.

```python
# face-service/inference.py
import numpy as np
from pathlib import Path
import tflite_runtime.interpreter as tflite

_MODEL_PATH = Path(__file__).parent / "models" / "mobilefacenet.tflite"

# Load once at import — this is the warm model kept in RAM
_interpreter = tflite.Interpreter(model_path=str(_MODEL_PATH))
_interpreter.allocate_tensors()

_input_details  = _interpreter.get_input_details()   # shape: [1, 112, 112, 3]
_output_details = _interpreter.get_output_details()  # shape: [1, 512]


def get_embedding(face_112: np.ndarray) -> np.ndarray:
    """
    Args:
        face_112: np.ndarray of shape (112, 112, 3), dtype float32, values in [-1, 1]
    Returns:
        embedding: np.ndarray of shape (512,), L2-normalized, dtype float32
    """
    if face_112.shape != (112, 112, 3):
        raise ValueError(f"Expected (112, 112, 3), got {face_112.shape}")

    # Add batch dimension
    input_data = np.expand_dims(face_112, axis=0).astype(np.float32)

    _interpreter.set_tensor(_input_details[0]['index'], input_data)
    _interpreter.invoke()

    embedding = _interpreter.get_tensor(_output_details[0]['index'])[0]  # (512,)

    # L2 normalize so cosine similarity = dot product
    norm = np.linalg.norm(embedding)
    if norm == 0:
        return embedding
    return (embedding / norm).astype(np.float32)


def warmup():
    """Run one dummy inference to pre-warm the interpreter. Call at startup."""
    dummy = np.zeros((112, 112, 3), dtype=np.float32)
    get_embedding(dummy)
```

- [ ] **Step 1: Create `face-service/inference.py` with content above**
- [ ] **Step 2: Test it manually in Termux**
  ```bash
  cd face-service
  python3 -c "
  from inference import get_embedding, warmup
  import numpy as np
  warmup()
  e = get_embedding(np.zeros((112,112,3), dtype='float32'))
  print('Embedding shape:', e.shape)
  print('L2 norm:', round(float(np.linalg.norm(e)), 4))
  "
  ```
  Expected:
  ```
  Embedding shape: (512,)
  L2 norm: 1.0
  ```
- [ ] **Step 3: Commit**
  ```bash
  git add face-service/inference.py
  git commit -m "feat: MobileFaceNet TFLite inference module"
  ```

---

## Task 4: Python Face Service — In-Memory Search Index

**Files:**
- Create: `face-service/search.py`

This module maintains a per-event embedding matrix in RAM. All similarity searches
happen here. No disk I/O during search — only during load/reload.

```python
# face-service/search.py
import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Tuple
import threading

@dataclass
class EmbeddingIndex:
    matrix: np.ndarray          # shape [N, 512], float32, L2-normalized
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
    Load embeddings for an event from raw DB rows into RAM.

    Args:
        event_id: str
        rows: list of (photo_id, face_index, embedding_bytes)
              embedding_bytes = 512 × float32 = 2048 bytes

    Returns:
        Number of embeddings loaded
    """
    if not rows:
        with _lock:
            _store[event_id] = EmbeddingIndex(
                matrix=np.zeros((0, 512), dtype=np.float32),
                photo_ids=[],
                face_indices=[]
            )
        return 0

    embeddings = []
    photo_ids  = []
    face_idxs  = []

    for photo_id, face_index, emb_bytes in rows:
        vec = np.frombuffer(emb_bytes, dtype=np.float32).copy()  # (512,)
        embeddings.append(vec)
        photo_ids.append(photo_id)
        face_idxs.append(face_index)

    matrix = np.stack(embeddings, axis=0)  # (N, 512)

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
        query_embedding: np.ndarray (512,), L2-normalized
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

    # Single matrix multiply — O(N), ~1ms for 5000 embeddings
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
```

- [ ] **Step 1: Create `face-service/search.py` with content above**
- [ ] **Step 2: Test it manually**
  ```bash
  cd face-service
  python3 -c "
  import numpy as np
  from search import load_event, search

  # Fake 3 embeddings for 2 photos
  def rand_emb():
      v = np.random.randn(512).astype('float32')
      return (v / np.linalg.norm(v)).tobytes()

  rows = [
      ('photo_1', 0, rand_emb()),
      ('photo_1', 1, rand_emb()),
      ('photo_2', 0, rand_emb()),
  ]
  n = load_event('evt_test', rows)
  print('Loaded:', n)

  # Query with exact copy of photo_1 face_0
  import struct
  vec = np.frombuffer(rows[0][2], dtype='float32').copy()
  result = search('evt_test', vec, high_threshold=0.90, low_threshold=0.55)
  print('Definite:', result['definite'])   # should include photo_1
  print('Possible:', result['possible'])
  "
  ```
  Expected: `Loaded: 3`, `Definite: ['photo_1']`
- [ ] **Step 3: Commit**
  ```bash
  git add face-service/search.py
  git commit -m "feat: in-memory embedding index + cosine search"
  ```

---

## Task 5: Python Face Service — Database Module

**Files:**
- Create: `face-service/db.py`

Handles all SQLite reads/writes for the face service. Uses stdlib `sqlite3` — no ORM.

```python
# face-service/db.py
import sqlite3
import numpy as np
from typing import List, Tuple, Optional
from pathlib import Path
import os

# DB path: resolve relative to this file, or from env var
_DB_PATH = os.environ.get(
    "DB_PATH",
    str(Path(__file__).parent.parent / "fotohaven.db")
)


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
            ON CONFLICT DO NOTHING
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
    Fetch all photo IDs + file paths for an event.
    Returns list of (photo_id, file_path).

    NOTE: Adapt the table/column names below to match your actual schema.
    Run `sqlite3 fotohaven.db '.schema photos'` to verify column names.
    """
    with _conn() as con:
        rows = con.execute(
            "SELECT id, file_path FROM photos WHERE event_id = ?",
            (event_id,)
        ).fetchall()
    return rows


def get_event_thresholds(event_id: str) -> Tuple[float, float]:
    """
    Returns (high_threshold, low_threshold) for an event.
    Defaults to (0.70, 0.55) if not configured.
    """
    with _conn() as con:
        row = con.execute(
            "SELECT high_threshold, low_threshold FROM events WHERE id = ?",
            (event_id,)
        ).fetchone()

    if row and row[0] is not None:
        return float(row[0]), float(row[1])
    return 0.70, 0.55
```

> **Important:** The `get_all_photo_paths` function assumes `photos.file_path` and
> `photos.event_id` columns. Verify against your actual schema and adjust if different.

- [ ] **Step 1: Run `sqlite3 fotohaven.db '.schema photos'` to check actual column names**
- [ ] **Step 2: Create `face-service/db.py` with content above, adjusting column names if needed**
- [ ] **Step 3: Test DB connection**
  ```bash
  cd face-service
  python3 -c "
  from db import get_event_thresholds
  # Use any event_id that exists in your DB, or a dummy
  h, l = get_event_thresholds('nonexistent')
  print('Defaults:', h, l)  # Expected: 0.7 0.55
  "
  ```
- [ ] **Step 4: Commit**
  ```bash
  git add face-service/db.py
  git commit -m "feat: face-service SQLite db module"
  ```

---

## Task 6: Python Face Service — Enrollment Module

**Files:**
- Create: `face-service/enrollment.py`

Processes all photos for an event: detects faces with MTCNN, aligns them, extracts
embeddings, stores in SQLite.

```python
# face-service/enrollment.py
import numpy as np
from PIL import Image
from pathlib import Path
from typing import Callable, Optional
from mtcnn import MTCNN
from inference import get_embedding
from db import save_embedding, delete_event_embeddings, get_all_photo_paths

# MTCNN is stateless — one instance, reused across calls
_detector = MTCNN()

# Root path where photo files are stored on disk
# Adjust if photos are stored elsewhere
_PHOTO_ROOT = Path(__file__).parent.parent / "public" / "uploads"


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
```

> **Photo path note:** `_PHOTO_ROOT` defaults to `public/uploads` relative to project root.
> Check where FotoHaven actually stores uploaded photos and update `_PHOTO_ROOT` if different.
> Run `sqlite3 fotohaven.db 'SELECT file_path FROM photos LIMIT 3'` to see actual paths.

- [ ] **Step 1: Run `sqlite3 fotohaven.db 'SELECT file_path FROM photos LIMIT 3'`** to check path format
- [ ] **Step 2: Create `face-service/enrollment.py` with content above, adjusting `_PHOTO_ROOT` if needed**
- [ ] **Step 3: Commit**
  ```bash
  git add face-service/enrollment.py
  git commit -m "feat: face enrollment with MTCNN detection + alignment"
  ```

---

## Task 7: Python Face Service — FastAPI Main App

**Files:**
- Create: `face-service/main.py`

```python
# face-service/main.py
import io
import base64
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from inference import get_embedding, warmup
from search import load_event, search, index_stats, unload_event
from enrollment import enroll_event
from db import get_all_event_embeddings, get_event_thresholds

app = FastAPI(title="FotoHaven Face Service", version="1.0.0")

# Only accessible from localhost — Next.js is the only caller
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# Single-thread executor for CPU-bound inference
# Single worker = no memory duplication of embedding matrix
_executor = ThreadPoolExecutor(max_workers=1)

# Track enrollment progress per event
_enrollment_status: dict = {}


# ── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    print("[startup] Warming up TFLite model...")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(_executor, warmup)
    print("[startup] Model warm. Loading all event embeddings...")
    # Optionally pre-load all events here if needed
    print("[startup] Ready.")


# ── Models ───────────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    event_id: str
    image_b64: str                            # base64 JPEG of aligned 112×112 face crop
    high_threshold: Optional[float] = None   # overrides DB config if provided
    low_threshold:  Optional[float] = None


class EnrollRequest(BaseModel):
    event_id: str


class ReloadRequest(BaseModel):
    event_id: str


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "indexed_events": index_stats()}


@app.post("/search")
async def search_faces(req: SearchRequest):
    """
    Receive a base64 112×112 face crop, return matching photo IDs.
    """
    # Decode image
    try:
        img_bytes = base64.b64decode(req.image_b64)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB").resize((112, 112))
        img_arr = np.array(img, dtype=np.float32) / 127.5 - 1.0  # normalize to [-1, 1]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    # Run inference in executor (CPU-bound)
    loop = asyncio.get_event_loop()
    embedding = await loop.run_in_executor(_executor, get_embedding, img_arr)

    # Load event index if not already in RAM
    # (lazy load — first search for an event triggers load)
    stats = index_stats()
    if req.event_id not in stats:
        rows = get_all_event_embeddings(req.event_id)
        load_event(req.event_id, rows)

    # Get thresholds — use request values or fall back to DB config
    db_high, db_low = get_event_thresholds(req.event_id)
    high_t = req.high_threshold if req.high_threshold is not None else db_high
    low_t  = req.low_threshold  if req.low_threshold  is not None else db_low

    result = search(req.event_id, embedding, high_t, low_t)

    return {
        "definite": result["definite"],
        "possible": result["possible"],
        "high_threshold": high_t,
        "low_threshold": low_t,
    }


@app.post("/enroll")
async def enroll(req: EnrollRequest):
    """
    Trigger face enrollment for all photos in an event.
    Long-running — client should poll /enroll/status.
    """
    event_id = req.event_id

    if _enrollment_status.get(event_id, {}).get("running"):
        return {"status": "already_running", **_enrollment_status[event_id]}

    _enrollment_status[event_id] = {"running": True, "current": 0, "total": 0}

    def progress_cb(current: int, total: int):
        _enrollment_status[event_id].update({"current": current, "total": total})

    def run():
        try:
            result = enroll_event(event_id, progress_cb=progress_cb)
            _enrollment_status[event_id] = {"running": False, "done": True, **result}
            # Reload in-memory index after enrollment
            rows = get_all_event_embeddings(event_id)
            load_event(event_id, rows)
        except Exception as e:
            _enrollment_status[event_id] = {"running": False, "error": str(e)}

    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, run)

    return {"status": "started", "event_id": event_id}


@app.get("/enroll/status/{event_id}")
def enroll_status(event_id: str):
    status = _enrollment_status.get(event_id, {"running": False, "done": False})
    return {"event_id": event_id, **status}


@app.post("/reload")
async def reload_index(req: ReloadRequest):
    """Force reload of in-memory embedding index from SQLite."""
    rows = get_all_event_embeddings(req.event_id)
    n = load_event(req.event_id, rows)
    return {"event_id": req.event_id, "embeddings_loaded": n}
```

- [ ] **Step 1: Create `face-service/main.py` with content above**
- [ ] **Step 2: Start the service and verify it starts**
  ```bash
  cd face-service
  uvicorn main:app --host 127.0.0.1 --port 5001 --workers 1
  ```
  Expected output:
  ```
  [startup] Warming up TFLite model...
  [startup] Model warm. Loading all event embeddings...
  [startup] Ready.
  INFO: Uvicorn running on http://127.0.0.1:5001
  ```
- [ ] **Step 3: Test health endpoint**
  ```bash
  curl http://127.0.0.1:5001/health
  ```
  Expected: `{"status":"ok","indexed_events":{}}`
- [ ] **Step 4: Stop the service (Ctrl+C), then commit**
  ```bash
  git add face-service/main.py
  git commit -m "feat: FastAPI face service with search/enroll/reload/health endpoints"
  ```

---

## Task 8: PM2 — Add Face Service Process

**Files:**
- Modify: `ecosystem.config.js`

Open `ecosystem.config.js`. It currently has one process (Next.js). Add the face service.

Find the `apps` array and add a second entry:

```javascript
{
  name: "face-service",
  script: "uvicorn",
  args: "main:app --host 127.0.0.1 --port 5001 --workers 1",
  cwd: "./face-service",
  interpreter: "python3",
  restart_delay: 3000,
  max_restarts: 10,
  min_uptime: "10s",
  watch: false,
  env: {
    DB_PATH: "../fotohaven.db",   // relative to face-service/ dir
    PYTHONUNBUFFERED: "1"
  }
}
```

> **Termux wake lock note:** The face service shares the same Termux session as Next.js.
> Your existing wake lock / `termux-wake-lock` setup already covers it.
> If using a root Doze workaround, no extra steps needed.

- [ ] **Step 1: Open `ecosystem.config.js` and add the face-service entry as shown**
- [ ] **Step 2: Reload PM2**
  ```bash
  pm2 reload ecosystem.config.js
  ```
- [ ] **Step 3: Verify both processes running**
  ```bash
  pm2 status
  ```
  Expected: both `fotohaven` (or your Next.js app name) and `face-service` show `online`
- [ ] **Step 4: Check face service logs**
  ```bash
  pm2 logs face-service --lines 20
  ```
  Expected: startup warmup messages, `Ready.`
- [ ] **Step 5: Save PM2 process list**
  ```bash
  pm2 save
  ```
- [ ] **Step 6: Commit**
  ```bash
  git add ecosystem.config.js
  git commit -m "feat: add face-service to PM2 ecosystem"
  ```

---

## Task 9: Next.js — API Routes

**Files:**
- Create: `app/api/recognize/route.ts`
- Create: `app/api/admin/enroll/[eventId]/route.ts`
- Create: `app/api/admin/events/[id]/thresholds/route.ts`

### app/api/recognize/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'  // or your existing auth method

const FACE_SERVICE = 'http://127.0.0.1:5001'

export async function POST(req: NextRequest) {
  // Verify guest is authenticated (has valid OTP session for this event)
  // Adapt to your existing auth pattern
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    event_id: string
    image_b64: string
    high_threshold?: number
    low_threshold?: number
  }

  if (!body.event_id || !body.image_b64) {
    return NextResponse.json({ error: 'Missing event_id or image_b64' }, { status: 400 })
  }

  try {
    const res = await fetch(`${FACE_SERVICE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),  // 10s timeout
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: err }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json(data)

  } catch (err) {
    console.error('[recognize] face service error:', err)
    return NextResponse.json({ error: 'Face service unavailable' }, { status: 503 })
  }
}
```

### app/api/admin/enroll/[eventId]/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server'

const FACE_SERVICE = 'http://127.0.0.1:5001'

// POST — trigger enrollment
export async function POST(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  // TODO: verify photographer session here using your existing auth pattern

  const { eventId } = params

  const res = await fetch(`${FACE_SERVICE}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId }),
    signal: AbortSignal.timeout(5_000),
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

// GET — poll enrollment status
export async function GET(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const { eventId } = params

  const res = await fetch(`${FACE_SERVICE}/enroll/status/${eventId}`, {
    signal: AbortSignal.timeout(3_000),
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
```

### app/api/admin/events/[id]/thresholds/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { events } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // TODO: verify photographer session here

  const body = await req.json() as {
    high_threshold?: number
    low_threshold?: number
  }

  const high = body.high_threshold
  const low  = body.low_threshold

  if (high !== undefined && (high < 0.1 || high > 1.0)) {
    return NextResponse.json({ error: 'high_threshold must be 0.1–1.0' }, { status: 400 })
  }
  if (low !== undefined && (low < 0.1 || low > 1.0)) {
    return NextResponse.json({ error: 'low_threshold must be 0.1–1.0' }, { status: 400 })
  }
  if (high !== undefined && low !== undefined && low >= high) {
    return NextResponse.json({ error: 'low_threshold must be less than high_threshold' }, { status: 400 })
  }

  await db.update(events)
    .set({
      ...(high !== undefined ? { highThreshold: high } : {}),
      ...(low  !== undefined ? { lowThreshold: low }   : {}),
    })
    .where(eq(events.id, params.id))

  // Reload face service index (thresholds are sent per-request, no reload needed)
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 1: Create all three route files as shown above**
- [ ] **Step 2: Adapt auth checks in each route to match your existing session/auth pattern**
  (check how existing API routes in `app/api/` handle auth — use the same pattern)
- [ ] **Step 3: Verify routes are reachable (Next.js dev server running)**
  ```bash
  curl -X POST http://localhost:3000/api/recognize \
    -H "Content-Type: application/json" \
    -d '{"event_id":"test","image_b64":""}' 
  ```
  Expected: 401 Unauthorized (auth guard works) or 400 (if no auth guard yet)
- [ ] **Step 4: Commit**
  ```bash
  git add app/api/recognize/ app/api/admin/enroll/ app/api/admin/events/
  git commit -m "feat: Next.js API routes for recognize, enroll, thresholds"
  ```

---

## Task 10: Frontend — FaceScanner Component

**Files:**
- Create: `components/face-scanner/FaceScanner.tsx`
- Create: `components/face-scanner/FaceScanResults.tsx`

### FaceScanner.tsx

MediaPipe loads from CDN via a `<script>` tag. The component:
1. Opens camera
2. Runs MediaPipe FaceMesh in real time
3. Shows alignment overlay
4. Auto-captures when face is stable for 1 second
5. Sends cropped 112×112 base64 JPEG to `/api/recognize`
6. Calls `onResults` with tiered photo IDs

```typescript
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface FaceScannerProps {
  eventId: string
  onResults: (definite: string[], possible: string[]) => void
  onClose: () => void
}

type ScanState = 'loading' | 'scanning' | 'capturing' | 'processing' | 'done' | 'error'

export function FaceScanner({ eventId, onResults, onClose }: FaceScannerProps) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)
  const stableRef  = useRef<number>(0)        // frames face has been stable
  const capturedRef = useRef(false)

  const [state, setState] = useState<ScanState>('loading')
  const [message, setMessage] = useState('Loading face detection...')

  // Load MediaPipe from CDN
  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js'
    script.crossOrigin = 'anonymous'
    script.onload = () => startCamera()
    document.head.appendChild(script)
    return () => { document.head.removeChild(script) }
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          videoRef.current!.play()
          setState('scanning')
          setMessage('Position your face in the frame')
          startDetection()
        }
      }
    } catch {
      setState('error')
      setMessage('Camera access denied. Please allow camera and retry.')
    }
  }

  const startDetection = useCallback(() => {
    // @ts-ignore — MediaPipe loaded from CDN
    const faceMesh = new window.FaceMesh({
      locateFile: (file: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    })

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    })

    faceMesh.onResults((results: any) => {
      if (capturedRef.current) return

      const canvas  = canvasRef.current
      const video   = videoRef.current
      if (!canvas || !video) return

      const ctx = canvas.getContext('2d')!
      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)

      if (results.multiFaceLandmarks?.length > 0) {
        const landmarks = results.multiFaceLandmarks[0]
        drawOverlay(ctx, landmarks, canvas.width, canvas.height)
        stableRef.current += 1

        // After 30 stable frames (~1s at 30fps) — capture
        if (stableRef.current >= 30) {
          capturedRef.current = true
          setState('capturing')
          setMessage('Got it! Searching your photos...')
          captureAndSend(canvas, landmarks)
        } else if (stableRef.current > 10) {
          setMessage('Hold still...')
        }
      } else {
        stableRef.current = 0
        setMessage('Position your face in the frame')
        drawNoFace(ctx, canvas.width, canvas.height)
      }
    })

    // @ts-ignore
    const camera = new window.Camera(videoRef.current, {
      onFrame: async () => { await faceMesh.send({ image: videoRef.current }) },
      width: 640,
      height: 480,
    })
    camera.start()
  }, [])

  const captureAndSend = async (
    canvas: HTMLCanvasElement,
    landmarks: any[]
  ) => {
    setState('processing')

    // Get bounding box from landmarks
    const xs = landmarks.map((l: any) => l.x * canvas.width)
    const ys = landmarks.map((l: any) => l.y * canvas.height)
    const minX = Math.max(0, Math.min(...xs) - 20)
    const minY = Math.max(0, Math.min(...ys) - 30)
    const maxX = Math.min(canvas.width,  Math.max(...xs) + 20)
    const maxY = Math.min(canvas.height, Math.max(...ys) + 20)

    // Crop face region
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width  = 112
    cropCanvas.height = 112
    const cropCtx = cropCanvas.getContext('2d')!
    cropCtx.drawImage(
      canvas,
      minX, minY, maxX - minX, maxY - minY,
      0, 0, 112, 112
    )

    // Export as base64 JPEG
    const image_b64 = cropCanvas.toDataURL('image/jpeg', 0.9).split(',')[1]

    try {
      const res = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, image_b64 }),
      })

      if (!res.ok) throw new Error(await res.text())

      const data = await res.json()
      setState('done')
      stopCamera()
      onResults(data.definite, data.possible)

    } catch (err) {
      setState('error')
      setMessage('Something went wrong. Please try again.')
      capturedRef.current = false
      stableRef.current   = 0
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  const drawOverlay = (
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    w: number,
    h: number
  ) => {
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 2
    // Draw simplified face oval from landmarks
    ctx.beginPath()
    const xs = landmarks.map((l: any) => l.x * w)
    const ys = landmarks.map((l: any) => l.y * h)
    const cx = xs.reduce((a: number, b: number) => a + b) / xs.length
    const cy = ys.reduce((a: number, b: number) => a + b) / ys.length
    const rx = (Math.max(...xs) - Math.min(...xs)) / 2 + 15
    const ry = (Math.max(...ys) - Math.min(...ys)) / 2 + 20
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  const drawNoFace = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(w / 2, h / 2, 100, 130, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  useEffect(() => () => stopCamera(), [])

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl overflow-hidden w-full max-w-md mx-4">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="font-semibold text-lg">Find My Photos</h2>
          <button onClick={() => { stopCamera(); onClose() }} className="text-gray-500 hover:text-gray-800 text-xl">✕</button>
        </div>

        <div className="relative bg-black aspect-[4/3] w-full">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
          {state === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              Loading…
            </div>
          )}
        </div>

        <div className="p-4 text-center">
          <p className="text-sm text-gray-600">{message}</p>
          {state === 'processing' && (
            <div className="mt-2 h-1 w-full bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 animate-pulse w-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

### FaceScanResults.tsx

```typescript
'use client'

interface FaceScanResultsProps {
  definite: string[]
  possible: string[]
  getPhotoUrl: (photoId: string) => string
  onReset: () => void
}

export function FaceScanResults({
  definite,
  possible,
  getPhotoUrl,
  onReset,
}: FaceScanResultsProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          Your Photos ({definite.length})
        </h2>
        <button
          onClick={onReset}
          className="text-sm text-blue-600 hover:underline"
        >
          Scan Again
        </button>
      </div>

      {definite.length === 0 && (
        <p className="text-gray-500 text-sm">
          No definite matches found. Check possible matches below.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {definite.map(id => (
          <img
            key={id}
            src={getPhotoUrl(id)}
            alt=""
            className="w-full aspect-square object-cover rounded-lg"
          />
        ))}
      </div>

      {possible.length > 0 && (
        <details className="border rounded-lg p-4">
          <summary className="cursor-pointer font-medium text-gray-700 select-none">
            Possible Matches ({possible.length})
          </summary>
          <p className="text-xs text-gray-500 mt-1 mb-3">
            Lower confidence — you may or may not appear in these.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
            {possible.map(id => (
              <img
                key={id}
                src={getPhotoUrl(id)}
                alt=""
                className="w-full aspect-square object-cover rounded-lg opacity-80"
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
```

- [ ] **Step 1: Create `components/face-scanner/FaceScanner.tsx`**
- [ ] **Step 2: Create `components/face-scanner/FaceScanResults.tsx`**
- [ ] **Step 3: Add MediaPipe Camera script to CDN imports**
  In `FaceScanner.tsx` `startDetection`, MediaPipe's `Camera` class needs a second CDN script.
  Add alongside the `face_mesh.js` load:
  ```typescript
  const camScript = document.createElement('script')
  camScript.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js'
  camScript.crossOrigin = 'anonymous'
  document.head.appendChild(camScript)
  ```
- [ ] **Step 4: Commit**
  ```bash
  git add components/face-scanner/
  git commit -m "feat: FaceScanner + FaceScanResults components"
  ```

---

## Task 11: Integrate Scanner into Guest Event Page

**Files:**
- Modify: `app/(guest)/event/[id]/page.tsx`

Open the guest event page. Find where photos are listed/displayed.

Add the following imports at the top:

```typescript
import { FaceScanner } from '@/components/face-scanner/FaceScanner'
import { FaceScanResults } from '@/components/face-scanner/FaceScanResults'
```

Add state to the component:

```typescript
const [showScanner, setShowScanner] = useState(false)
const [scanResults, setScanResults] = useState<{
  definite: string[]
  possible: string[]
} | null>(null)
```

Add the "Find My Photos" button near the top of the photo grid:

```tsx
<button
  onClick={() => { setScanResults(null); setShowScanner(true) }}
  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
>
  <span>🔍</span> Find My Photos
</button>

{showScanner && (
  <FaceScanner
    eventId={params.id}
    onResults={(definite, possible) => {
      setScanResults({ definite, possible })
      setShowScanner(false)
    }}
    onClose={() => setShowScanner(false)}
  />
)}

{scanResults && (
  <FaceScanResults
    definite={scanResults.definite}
    possible={scanResults.possible}
    getPhotoUrl={(photoId) => `/api/photos/${photoId}`}  // adjust to your photo serving route
    onReset={() => setScanResults(null)}
  />
)}
```

> **Note:** Replace `/api/photos/${photoId}` with the actual URL pattern your app uses
> to serve photos. Check existing photo display code in this file or `components/`.

- [ ] **Step 1: Open `app/(guest)/event/[id]/page.tsx` and read existing structure**
- [ ] **Step 2: Add imports, state, and JSX as shown above**
- [ ] **Step 3: Verify the page compiles**
  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors
- [ ] **Step 4: Commit**
  ```bash
  git add app/(guest)/event/
  git commit -m "feat: add Find My Photos button + scanner integration to guest event page"
  ```

---

## Task 12: Photographer Admin — Enroll Button + Threshold Sliders

**Files:**
- Modify: existing photographer admin/dashboard page for event management
  (find the page that has the existing "Process Photos" or similar button — run
  `grep -r "Process" app/` to locate it)

Add enrollment trigger and threshold controls. Find the event management page and add:

```tsx
'use client'
// Add to existing imports:
import { useState } from 'react'

// Add inside component:
const [enrollStatus, setEnrollStatus] = useState<string>('')
const [enrollRunning, setEnrollRunning] = useState(false)
const [high, setHigh] = useState(event.highThreshold ?? 0.70)
const [low,  setLow]  = useState(event.lowThreshold  ?? 0.55)

const triggerEnroll = async () => {
  setEnrollRunning(true)
  setEnrollStatus('Starting...')

  await fetch(`/api/admin/enroll/${event.id}`, { method: 'POST' })

  // Poll status every 2s
  const poll = setInterval(async () => {
    const res  = await fetch(`/api/admin/enroll/${event.id}`)
    const data = await res.json()
    if (data.running) {
      setEnrollStatus(`Processing ${data.current} / ${data.total} photos...`)
    } else {
      clearInterval(poll)
      setEnrollRunning(false)
      setEnrollStatus(
        data.error
          ? `Error: ${data.error}`
          : `Done — ${data.faces_found} faces found in ${data.processed} photos`
      )
    }
  }, 2000)
}

const saveThresholds = async () => {
  await fetch(`/api/admin/events/${event.id}/thresholds`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ high_threshold: high, low_threshold: low }),
  })
}
```

Add JSX (add near the existing "Process Photos" button):

```tsx
<div className="border rounded-lg p-4 space-y-4">
  <h3 className="font-medium">Face Recognition</h3>

  <button
    onClick={triggerEnroll}
    disabled={enrollRunning}
    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
  >
    {enrollRunning ? 'Processing...' : 'Process Faces'}
  </button>

  {enrollStatus && <p className="text-sm text-gray-600">{enrollStatus}</p>}

  <div className="space-y-3 pt-2 border-t">
    <p className="text-sm font-medium text-gray-700">Match Sensitivity</p>

    <label className="block text-xs text-gray-500">
      Definite match threshold: <strong>{high.toFixed(2)}</strong>
      <input type="range" min={0.5} max={0.95} step={0.01}
        value={high} onChange={e => setHigh(parseFloat(e.target.value))}
        className="w-full mt-1" />
    </label>

    <label className="block text-xs text-gray-500">
      Possible match threshold: <strong>{low.toFixed(2)}</strong>
      <input type="range" min={0.3} max={0.85} step={0.01}
        value={low} onChange={e => setLow(parseFloat(e.target.value))}
        className="w-full mt-1" />
    </label>

    <p className="text-xs text-gray-400">
      Lower = more photos shown. Higher = stricter matching.
    </p>

    <button onClick={saveThresholds}
      className="text-sm text-indigo-600 hover:underline">
      Save thresholds
    </button>
  </div>
</div>
```

- [ ] **Step 1: Run `grep -r "Process" app/` to find the admin page**
- [ ] **Step 2: Add the enrollment + threshold JSX and handlers as shown**
- [ ] **Step 3: Pass `event.highThreshold` and `event.lowThreshold` from your DB query to the component**
  (update the existing DB query that fetches event data to include these two new columns)
- [ ] **Step 4: Verify page compiles**
  ```bash
  npx tsc --noEmit
  ```
- [ ] **Step 5: Commit**
  ```bash
  git add app/
  git commit -m "feat: photographer admin — process faces button + threshold sliders"
  ```

---

## Task 13: End-to-End Smoke Test

Run through the full flow manually to verify everything works together.

- [ ] **Step 1: Confirm both PM2 processes are online**
  ```bash
  pm2 status
  # Expected: fotohaven = online, face-service = online
  ```

- [ ] **Step 2: Enroll a test event**
  ```bash
  # Use a real event_id from your DB
  EVENT_ID=$(sqlite3 fotohaven.db "SELECT id FROM events LIMIT 1")
  curl -X POST http://localhost:5001/enroll \
    -H "Content-Type: application/json" \
    -d "{\"event_id\": \"$EVENT_ID\"}"
  # Expected: {"status":"started","event_id":"..."}
  ```

- [ ] **Step 3: Poll enrollment status until done**
  ```bash
  curl http://localhost:5001/enroll/status/$EVENT_ID
  # Poll until: {"running":false,"done":true,"processed":N,"faces_found":M}
  ```

- [ ] **Step 4: Verify embeddings stored in DB**
  ```bash
  sqlite3 fotohaven.db "SELECT COUNT(*) FROM face_embeddings WHERE event_id='$EVENT_ID'"
  # Expected: matches faces_found count from step 3
  ```

- [ ] **Step 5: Test search via face service directly**
  ```bash
  # Pull an embedding from DB and search for it (should get high similarity hits)
  python3 face-service/test_search.py $EVENT_ID
  # (create this quick test script — see below)
  ```

  Create `face-service/test_search.py`:
  ```python
  import sys, sqlite3, numpy as np
  from search import load_event, search
  from db import get_all_event_embeddings

  event_id = sys.argv[1]
  rows = get_all_event_embeddings(event_id)
  if not rows:
      print("No embeddings found for event:", event_id)
      sys.exit(1)
  load_event(event_id, rows)
  print(f"Loaded {len(rows)} embeddings")

  # Use first embedding as query — should match its own photo at ~1.0
  photo_id_0, _, emb_bytes_0 = rows[0]
  query = np.frombuffer(emb_bytes_0, dtype=np.float32).copy()
  result = search(event_id, query, high_threshold=0.70, low_threshold=0.55)
  print("Query photo:", photo_id_0)
  print("Definite:", result['definite'][:5])
  print("Possible:", result['possible'][:5])
  assert photo_id_0 in result['definite'], "FAIL: own photo not in definite matches"
  print("PASS")
  ```

- [ ] **Step 6: Open browser, authenticate as guest via OTP, click "Find My Photos"**
  Verify camera opens, face overlay appears, auto-capture triggers, results shown.

- [ ] **Step 7: Final commit**
  ```bash
  git add face-service/test_search.py
  git commit -m "test: face recognition smoke test script"
  ```

---

## Known Gotchas for the Agent

1. **`photos.file_path` format** — could be absolute (`/data/data/.../uploads/photo.jpg`),
   relative (`uploads/photo.jpg`), or URL-relative (`/uploads/photo.jpg`).
   Check with `sqlite3 fotohaven.db 'SELECT file_path FROM photos LIMIT 3'` before running enrollment.

2. **tflite-runtime wheel** — if `pip install tflite-runtime` fails on Termux,
   the `setup.sh` fallback installs the community ARM64 wheel. If that also fails,
   try `pip install ai-edge-litert` which is Google's renamed replacement package
   and update `import tflite_runtime.interpreter` → `import ai_edge_litert.interpreter`.

3. **MTCNN first run** — MTCNN downloads its own model weights on first call (~50MB).
   This happens silently during the first `/enroll` request. Subsequent calls are fast.

4. **MediaPipe CDN on mobile** — the MediaPipe WASM bundle is ~8MB.
   On slow connections first load is slow. The camera modal shows "Loading..." until ready.
   No action needed — this is expected behavior.

5. **SQLite `ON CONFLICT DO NOTHING`** — the enrollment upsert uses this so re-running
   enrollment on the same event first deletes all embeddings for that event
   (via `delete_event_embeddings`) then re-inserts. This prevents duplicate embeddings.

6. **Drizzle column name casing** — Drizzle generates camelCase TypeScript names
   (`highThreshold`) that map to snake_case SQLite columns (`high_threshold`).
   The Python `db.py` uses raw SQL with `high_threshold` (snake_case) — this is correct.

---

## Summary of All New Files

```
face-service/
  main.py           FastAPI app
  inference.py      TFLite model + embedding extraction
  search.py         In-memory index + cosine search
  enrollment.py     MTCNN batch enrollment
  db.py             SQLite read/write
  requirements.txt
  setup.sh
  test_search.py
  models/
    mobilefacenet.tflite   (downloaded by setup.sh)

app/api/
  recognize/route.ts
  admin/enroll/[eventId]/route.ts
  admin/events/[id]/thresholds/route.ts

components/face-scanner/
  FaceScanner.tsx
  FaceScanResults.tsx

lib/schema.ts              (modified — face_embeddings + threshold cols)
ecosystem.config.js        (modified — face-service process added)
app/(guest)/event/[id]/page.tsx   (modified — scanner integration)
app/(photographer)/.../page.tsx   (modified — enroll button + sliders)
```
