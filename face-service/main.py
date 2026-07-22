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
from pydantic import BaseModel

from inference import get_embedding, warmup
from search import load_event, search, index_stats
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
