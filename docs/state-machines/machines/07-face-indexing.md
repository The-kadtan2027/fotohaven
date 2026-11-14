# Machine 07 — Face enrollment and indexing

Owners: `src/app/albums/[albumId]/FaceProcessor.tsx`, `/api/photos/:id/faces`, `/api/albums/:id/reprocess-faces`, `src/app/api/admin/enroll/[eventId]/route.ts`, `native-face-service/*`.

## As-is

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> LoadingModels: queue non-empty
    LoadingModels --> Processing: models ok
    LoadingModels --> Banner: models fail (rejected promise cached forever)
    Processing --> Processing: photo fetch/decode/save
    Processing --> Complete: queue exhausted
    Processing --> Dismissed: user dismiss
    Banner --> Banner: no retry for the rest of the session
    Complete --> Idle: album refresh with new queue
    [*] --> Polling: admin clicks Process Faces
    Polling --> Polling: status.running (every 2 s, no deadline)
    Polling --> Done: running=false
    Polling --> Error: non-OK / status.error
```

Observed:

- `modelLoadPromise` caches rejection (`FaceProcessor.tsx:25-38`) so a transient CDN/404 failure disables face indexing until reload.
- Fatal load failure leaves the banner in “Processing faces (0/N)” (running false, `completeCount` null).
- Admin polling has no deadline and no unmount cancellation (`albums/[albumId]/page.tsx:608-641`). If the service keeps `running:true`, the button is disabled forever.
- Reprocess clears `photoFaces` and `face_embeddings` and sets `faceProcessed=false` in one transaction; good.
- Browser indexing and native indexing write different tables; the vector cache prefers 128-d `photoFaces` if any exist, otherwise 512-d `face_embeddings`.

## To-be

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> LoadingModels: queue non-empty
    LoadingModels --> Processing: success
    LoadingModels --> LoadError: rejection (promise reset)
    LoadError --> LoadingModels: Retry
    LoadError --> Dismissed: Dismiss
    Processing --> Processing: photo ok/fail (counted)
    Processing --> Complete: queue exhausted
    Complete --> Dismissed: Dismiss
    Dismissed --> Idle: new queue arrives
    Idle --> Polling: Process Faces
    Polling --> Polling: running (tick, <= 10 min)
    Polling --> Done: running=false
    Polling --> Error: non-OK, status.error, deadline
    Done --> Idle: album refresh
    Error --> Idle: user closes / retries
```

UI contract:

| State | Sees | Can do | Copy |
|---|---|---|---|
| Processing | fixed chip progress | Dismiss | “Processing faces (x/y)” |
| LoadError | chip with error | Retry, Dismiss | “Face models failed to load. Retry.” |
| Complete | chip summary | Dismiss | “Face processing complete (N photos, M failed)” |
| Polling | button spinner + status line | — (deadline abort) | “Processing 12 / 40 photos…” |
| PollError | status line in red | Process Faces again | server error message |

Persistence: descriptors in `PhotoFace`, native embeddings in `face_embeddings`, `Photo.faceProcessed` flag. Cache invalidation on faces POST and reprocess. No timers survive unmount after the fix.
