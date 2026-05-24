# Archived Scripts

These scripts were part of the **server-side face processing pipeline** and have been
retired in favour of **browser-side face extraction** via `FaceProcessor.tsx`.

## Why archived (not deleted)

They may be useful as a fallback if:
- The photographer's browser does not support WebGL / face-api.js
- You need to reprocess a large batch on a powerful machine (not on the Android phone)
- You want to study the `@napi-rs/canvas` + `face-api.js` Node.js integration pattern

## Scripts

### `process-faces.ts`
Node/TypeScript server script that reads unprocessed photos from the database,
runs face detection via `face-api.js` + `@napi-rs/canvas` (Node-compatible canvas),
and writes `PhotoFace` descriptors to the database.

**Env vars used:**
- `PROCESS_FACES_SOURCE` — `auto` | `original` | `thumbnail` (default: `auto`)
- `PROCESS_FACES_LIMIT` — max photos per run (default: `25`)
- `PROCESS_FACES_DETECTOR` — `tiny` | `ssd` | `hybrid` (default: `hybrid`)
- `PROCESS_FACES_TINY_INPUT` — input size for tiny detector (default: `128`)
- `PROCESS_FACES_TINY_SCORE` — score threshold for tiny detector (default: `0.5`)
- `PROCESS_FACES_SSD_INPUT` — input size for SSD (default: `224`)
- `PROCESS_FACES_SSD_CONFIDENCE` — confidence threshold for SSD (default: `0.5`)

**To run (requires `@napi-rs/canvas` installed):**
```bash
npm install @napi-rs/canvas @tensorflow/tfjs @tensorflow/tfjs-backend-wasm canvas
npx tsx scripts/archive/process-faces.ts
```

### `process-faces-safe.sh`
Bash wrapper that runs `process-faces.ts` safely via PM2, with a cron schedule.
Used when face processing was a background server-side job.

## Current architecture (as of phase 1 refactor)

Face inference runs **entirely in the photographer's browser** via `FaceProcessor.tsx`.
The Android phone only stores descriptors and runs cosine-distance matching — no
neural network inference on the phone CPU.
