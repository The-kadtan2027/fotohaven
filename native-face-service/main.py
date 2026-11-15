from __future__ import annotations

import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import numpy as np

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import (
    ENROLL_WORKERS,
    FACE_LOCAL_SERVICE_BIND,
    FACE_LOCAL_SERVICE_PORT,
    FACE_QUERY_FALLBACK_SIZE,
    SEARCH_MAX_RESULTS,
)
from db import (
    get_all_event_embeddings,
    get_event_thresholds,
    get_photo_embeddings,
)
from enrollment import enroll_event
from opencv_backend import (
    NoFaceDetected,
    cv2,
    decode_base64_image,
    extract_query_embedding,
    model_paths,
    models_ready,
    warmup,
)
from search import index_stats, load_event, search


app = FastAPI(title="FotoHaven Native Face Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_enroll_executor = ThreadPoolExecutor(max_workers=ENROLL_WORKERS)
_search_executor = ThreadPoolExecutor(max_workers=2)
_enrollment_status: dict[str, dict] = {}


class SearchRequest(BaseModel):
    event_id: str
    image_b64: str
    high_threshold: Optional[float] = None
    low_threshold: Optional[float] = None


class SearchByPhotosRequest(BaseModel):
    event_id: str
    photo_ids: list[str]
    high_threshold: Optional[float] = None
    low_threshold: Optional[float] = None


class EnrollRequest(BaseModel):
    event_id: str


@app.on_event("startup")
async def startup() -> None:
    if not models_ready():
        print("[native-face-service] Models missing. Health endpoint will report not ready.")
        return

    print("[native-face-service] Warming up OpenCV face models...")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(_search_executor, warmup)
    print("[native-face-service] Ready.")


@app.get("/health")
def health():
    return {
      "status": "ok" if models_ready() else "degraded",
      "service": "native-face-service",
      "bind": FACE_LOCAL_SERVICE_BIND,
      "port": FACE_LOCAL_SERVICE_PORT,
      "opencv_version": cv2.__version__,
      "models_ready": models_ready(),
      "model_paths": model_paths(),
      "indexed_events": index_stats(),
      "query_fallback_size": FACE_QUERY_FALLBACK_SIZE,
      "enroll_workers": ENROLL_WORKERS,
    }


@app.post("/search")
async def search_faces(req: SearchRequest):
    if not models_ready():
        raise HTTPException(status_code=503, detail="Face models are not installed")

    started = time.perf_counter()
    try:
        image = decode_base64_image(req.image_b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image: {exc}") from exc
    decode_ms = (time.perf_counter() - started) * 1000

    loop = asyncio.get_running_loop()
    query_started = time.perf_counter()
    try:
        embedding, faces_detected = await loop.run_in_executor(
            _search_executor, extract_query_embedding, image
        )
    except NoFaceDetected as exc:
        total_ms = (time.perf_counter() - started) * 1000
        print(
            f"[native-search] event={req.event_id} NO_FACE decode={decode_ms:.1f}ms total={total_ms:.1f}ms"
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": "No face detected. Center your face in the oval and try again.",
                "code": "NO_FACE",
                "faces_detected": 0,
            },
        )
    query_ms = (time.perf_counter() - query_started) * 1000

    if req.event_id not in index_stats():
        rows = get_all_event_embeddings(req.event_id)
        load_event(req.event_id, rows)

    db_high, db_low = get_event_thresholds(req.event_id)
    high_threshold = req.high_threshold if req.high_threshold is not None else db_high
    low_threshold = req.low_threshold if req.low_threshold is not None else db_low

    search_started = time.perf_counter()
    result = search(req.event_id, embedding, high_threshold, low_threshold, SEARCH_MAX_RESULTS)
    search_ms = (time.perf_counter() - search_started) * 1000
    total_ms = (time.perf_counter() - started) * 1000

    print(
        f"[native-search] event={req.event_id} faces={faces_detected} "
        f"best={result.get('best_score')} indexed={result.get('indexed_faces')} "
        f"definite={len(result['definite'])} possible={len(result['possible'])} "
        f"decode={decode_ms:.1f}ms query={query_ms:.1f}ms search={search_ms:.1f}ms total={total_ms:.1f}ms"
    )

    return {
        "definite": result["definite"],
        "possible": result["possible"],
        "high_threshold": high_threshold,
        "low_threshold": low_threshold,
        "embedding_dim": int(embedding.shape[0]),
        "faces_detected": faces_detected,
        "best_score": result.get("best_score"),
        "indexed_faces": result.get("indexed_faces"),
        "timings": {
            "decode_ms": round(decode_ms, 1),
            "query_ms": round(query_ms, 1),
            "search_ms": round(search_ms, 1),
            "total_ms": round(total_ms, 1),
        },
    }


@app.post("/search-by-photos")
async def search_by_photos(req: SearchByPhotosRequest):
    if not models_ready():
        raise HTTPException(status_code=503, detail="Face models are not installed")

    started = time.perf_counter()
    if not req.photo_ids:
        return {"definite": [], "possible": [], "best_score": None, "indexed_faces": 0}

    emb_bytes_list = get_photo_embeddings(req.event_id, req.photo_ids)
    if not emb_bytes_list:
        return {"definite": [], "possible": [], "best_score": None, "indexed_faces": 0}

    embeddings = [np.frombuffer(b, dtype=np.float32) for b in emb_bytes_list]
    avg_emb = np.mean(embeddings, axis=0)
    norm = np.linalg.norm(avg_emb)
    if norm > 0:
        avg_emb = avg_emb / norm

    if req.event_id not in index_stats():
        rows = get_all_event_embeddings(req.event_id)
        load_event(req.event_id, rows)

    db_high, db_low = get_event_thresholds(req.event_id)
    high_threshold = req.high_threshold if req.high_threshold is not None else max(db_high, 0.68)
    low_threshold = req.low_threshold if req.low_threshold is not None else db_low

    result = search(req.event_id, avg_emb, high_threshold, low_threshold, SEARCH_MAX_RESULTS)
    total_ms = (time.perf_counter() - started) * 1000
    print(
        f"[native-refine] event={req.event_id} anchors={len(req.photo_ids)} "
        f"best={result.get('best_score')} indexed={result.get('indexed_faces')} "
        f"definite={len(result['definite'])} possible={len(result['possible'])} total={total_ms:.1f}ms"
    )

    return {
        "definite": result["definite"],
        "possible": result["possible"],
        "high_threshold": high_threshold,
        "low_threshold": low_threshold,
        "best_score": result.get("best_score"),
        "indexed_faces": result.get("indexed_faces"),
        "timings": {"total_ms": round(total_ms, 1)},
    }


@app.post("/enroll")
async def enroll(req: EnrollRequest):
    if not models_ready():
        raise HTTPException(status_code=503, detail="Face models are not installed")

    event_id = req.event_id
    if _enrollment_status.get(event_id, {}).get("running"):
        return {"status": "already_running", **_enrollment_status[event_id]}

    _enrollment_status[event_id] = {"running": True, "current": 0, "total": 0}

    def progress_cb(current: int, total: int) -> None:
        _enrollment_status[event_id].update({"current": current, "total": total})

    def run() -> None:
        try:
            result = enroll_event(event_id, progress_cb=progress_cb)
            _enrollment_status[event_id] = {"running": False, "done": True, **result}
            rows = get_all_event_embeddings(event_id)
            load_event(event_id, rows)
        except Exception as exc:
            _enrollment_status[event_id] = {"running": False, "done": False, "error": str(exc)}

    loop = asyncio.get_running_loop()
    loop.run_in_executor(_enroll_executor, run)
    return {"status": "started", "event_id": event_id}


@app.get("/enroll/status/{event_id}")
def enroll_status(event_id: str):
    status = _enrollment_status.get(event_id, {"running": False, "done": False})
    return {"event_id": event_id, **status}
