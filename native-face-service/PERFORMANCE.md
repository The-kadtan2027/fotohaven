# Native face service — performance notes

Measured on the production phone (8 cores, Android 16, Python 3.13, OpenCV 4.x),
with a 2048×1365 album photo and an event containing **17,886 face embeddings**.

## Baseline (before)

| Operation | Time |
|---|---|
| One-photo detection + embedding | 723–1073 ms |
| `/search-by-photos`, cold index | 270 ms |
| `/search-by-photos`, warm index | 65–67 ms |
| DB writes | one connection/commit **per face** + one for `faceProcessed` |
| Query photo lookup | not scoped to `event_id`; no supporting indexes |

The search itself was already a single vectorized NumPy matrix multiply. The
expensive part was image decode + YuNet detection at full resolution.

## Changes

- Detection/alignment runs on a bounded copy only when the source is larger than
  `FACE_DETECTION_MAX_SIDE=2048`; bbox + landmark columns are scaled back before
  `alignCrop`. 2048 reproduces the existing 2048px embeddings exactly. Lowering
  to 1600 is ~30% faster but drifts old-vs-new embeddings (10 single-face
  samples: avg cosine 0.92, min 0.74), so 1600 is opt-in for speed.
- One enrollment worker with `OPENCV_NUM_THREADS=8`. Two competing workers were
  slower on this device (two photos in ~1.0 s vs 2 × 335 ms), and each worker
  loads another ~50 MB of models.
- Search and enrollment use separate executors, so a long enrollment does not
  block guest `/search` calls.
- All faces for one photo are inserted in **one transaction**, together with
  `Photo.faceProcessed`.
- SQLite indexes: `face_embeddings(event_id, photo_id)`,
  `face_embeddings(photo_id, event_id)`, `Photo(ceremonyId, isReturn, faceProcessed)`,
  `Ceremony(albumId)`; WAL/busy timeout/cache/mmap pragmas.
- `get_photo_embeddings` is scoped by `event_id`.
- Search responses are capped per tier (`SEARCH_MAX_RESULTS=500`).
- `ENROLL_WORKERS` and `OPENCV_NUM_THREADS` remain env-tunable.

## After

| Operation | Time |
|---|---|
| One-photo detection + embedding | **480 ms** warm at 2048; **335–410 ms** at 1600 (opt-in) |
| `/search-by-photos`, cold | **166 ms** |
| `/search-by-photos`, warm | **51 ms** |
| Enrollment DB writes | one transaction per photo |
| DB index creation | additive, on service start |

Memory stays bounded: one enrollment model + up to two search models (~150 MB
worst case), versus multiple per-thread model copies previously.

## Why not Rust (yet)

- 17,886 × 128 dot products already take ~51 ms including JSON/SQLite overhead.
  A Rust rewrite of the search loop would save single-digit milliseconds.
- The measured bottleneck is OpenCV image decode/detection, which is already C++
  running under Python. A Rust service would need ONNX Runtime, model asset
  handling, alignment, SQLite access and a new deployment path on Termux/ARM64
  to reach the same feature set.
- Revisit Rust (or a dedicated vector index such as FAISS) when the event has
  ~500k+ embeddings or search latency exceeds ~500 ms. At that point the right
  split is a narrow Rust vector-search service fed by the existing SQLite data,
  not a full rewrite of detection/enrollment.

Tunables: `FACE_DETECTION_MAX_SIDE`, `OPENCV_NUM_THREADS`, `ENROLL_WORKERS`,
`SEARCH_MAX_RESULTS`.
