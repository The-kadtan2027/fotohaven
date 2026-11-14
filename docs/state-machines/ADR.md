# ADR — State-machine audit decisions

Status: accepted for branch `state-machine-audit`.

## ADR-001: Serialize check-then-set state into typed reducers, not booleans

**Context.** The upload queue and share selection have impossible combinations (`status:"done"` items rendered, `uploading` without an in-flight claim, selection state updated while a PATCH is in flight) and side effects inside state updaters.

**Decision.** Add three small pure modules:
- `src/lib/upload-queue.ts` — discriminated `UploadStatus` with a total reducer.
- `src/lib/selection-machine.ts` — per-photo intent versions for optimistic updates.
- `src/lib/guest-scan.ts` — pure `reduceScanPhase` used by the guest camera overlay.

No state library. Events are facts (`succeed`, `fail`, `toggle`), guards are pure, network effects stay in the component.

**Rejected.** XState/Zustand: new dependency, no existing pattern, and the machines are small. Keeping component-local `useState` clusters: leaves the defect class intact.

## ADR-002: Reducer, not server round-trip, for per-selection versioning

**Context.** `PATCH /api/photos/:id` is fire-and-forget. Failed requests leave the UI ahead of the DB; old responses cannot arrive (no response handling at all).

**Decision.** Keep optimistic UI, add a monotonically increasing per-photo intent version. A failure only rolls back if no newer intent exists. On rollback show a toast. Server remains source of truth on reload.

**Rejected.** Blocking UI on every PATCH (bad for a client starring dozens of photos) and polling (adds load to the phone).

## ADR-003: Upload compensation via existing DELETE, no schema change

**Context.** `POST /api/upload` creates the row before bytes land. A failed XHR leaves a phantom photo; retry creates a duplicate.

**Decision.** Client keeps the returned `photoId` on the queue item. On upload failure *and* on removing a failed item, it calls the already-authenticated `DELETE /api/photos/:id`. On retry, a new metadata POST is issued, so every attempt has exactly one row. Metadata POST retries only when no row was created (non-2xx is ambiguous for 5xx; the row may exist, so we do **not** blindly retry a 5xx metadata POST — we fail and clean up).

**Rejected.** A `pending` → `confirmed` photo state column (schema change and large API surface), and a confirm endpoint that verifies bytes on disk (storage adapter is local now but R2 later; verification would need a head-object API). A client-closed tab can still orphan a row; documented residual risk and follow-up L-10.

## ADR-004: Share password/expiry enforced at every read/write endpoint

**Context.** `POST /api/share/:token/download` and `/upload` accepted the token alone; the ceremony-photos route did not verify ceremony ownership.

**Decision.** Enforce the same guard as the main share GET: expiry first, then bcrypt compare. Downloads accept the password either as `Authorization: Bearer` or as the `password` form field; return uploads accept it in the JSON body. Ceremony photo queries join `Ceremony` and require the album match. This keeps the public contract (same endpoints, additive fields) and closes the bypass.

**Rejected.** A short-lived signed cookie after password entry: more moving parts, and the current page already keeps the password in memory for every request.

## ADR-005: Job retry due-time in `updatedAt`

**Context.** The `JobQueue` table has no `runAt` column. Failed jobs are set to `pending` and immediately reclaimed.

**Decision.** Treat `updatedAt` as "not before" for pending jobs (`updatedAt <= now`), and on failure set it to `now + backoff`, where backoff is `min(30s × 2^(attempt-1), 5min)`. Stuck-job recovery keeps its 5-minute lease and never moves `updatedAt` backwards. Documented trade-off: `updatedAt` no longer means "last modified" for pending rows; it means "eligible at".

**Rejected.** Schema migration adding `runAt` (reversible but unnecessary for one instance), and a sleep in the worker (blocks the only worker and makes the queue unresponsive).

## ADR-006: In-memory rate limiting for OTP and login

**Context.** 6-digit OTPs are valid for 10 minutes with unlimited attempts; admin login has unlimited attempts.

**Decision.** A shared sliding-window limiter (`src/lib/rate-limit.ts`) keyed by `scope:ip:identity`:
- OTP send: 3 per 10 min per album+email, 10 per 10 min per IP.
- OTP verify: 5 failures per 10 min per album+email, 20 per 10 min per IP.
- Login: 5 failures per 15 min per IP+username.
Successful verify/login clears the identity bucket. `429` with `Retry-After`.

**Trade-off.** Process-local; resets on restart; one instance only (`ecosystem.config.js`). Documented as L-11. A SQLite-backed limiter would survive restarts but adds write contention to the same DB used by uploads.

## ADR-007: Remove the no-op compression concurrency control

**Context.** The UI exposes "Preparation Concurrency" and the page imports `mapWithConcurrency`, but compression is sequential (`uploadAll`). The sequential path was a deliberate memory fix (commits `9c53699`, `3ee…`). A control that changes nothing is worse than no control.

**Decision.** Remove the control, the state, and the dead helper; state in the settings panel that compression is sequential by design. If parallel preparation returns, it must be implemented with a bounded window and memory caps, not a UI slider alone.

**Rejected.** Implementing parallelism now: it reintroduces the exact heap pressure that crashed tabs with large batches; not justified by a state-machine audit.

## ADR-008: End-of-day expiry semantics at the client boundary

**Context.** `<input type="date">` yields `YYYY-MM-DD`; `new Date("YYYY-MM-DD")` is UTC midnight. In IST that is 05:30 on the chosen day.

**Decision.** Convert in the wizard to `new Date(`${date}T23:59:59.999`).toISOString()` before POST. Server parsing unchanged; existing rows keep their old meaning. Documented so a future server-side date-only parser does not reintroduce the bug.

**Rejected.** Changing the server to interpret date-only strings in the server timezone: the server runs on Android/Termux with an unknown TZ, and it would silently reinterpret existing rows.

## ADR-009: Cache exclusion list in the service worker

**Context.** The SW caches every successful API GET, including guest face results and auth identity.

**Decision.** Exclude `/api/auth/`, `/api/admin/`, `/api/guest/`, `/api/recognize` from Cache Storage. Keep photo files and public share reads. Bump cache names to evict old entries.

**Trade-off.** Offline face discovery is not supported (it never was: matching runs on the server). Offline share browsing still works for previously visited ceremonies.

## ADR-010: What was deliberately not changed

- **Guest page full reducer.** A flat 1689-line component resists a safe mechanical reducer extraction within one audit. The defect class that mattered (unreachable errors, unchecked enroll) was fixed locally; the typed `guest-scan` helper covers the overlay. A full extraction is listed as follow-up.
- **Toast/lightbox accessibility.** Reported (L-03/L-04) with evidence; a component-wide a11y pass is a separate change with its own review surface.
- **Admin health blocking `execSync`.** Reported (L-05); changing it needs a caching design and is not a state-machine defect.
- **`.env.example` secret and tracked DB.** Reported (L-01); rotating/removing secrets is owner action.

## ADR-011: Key-bound upload tokens for the public share flow

**Context.** `/api/upload/local` is admin-guarded by middleware, but the share-page return-upload flow is intentionally unauthenticated (token + optional password). Runtime check showed the final PUT returned 401, so the documented flow never completed.

**Decision.** The share/admin metadata routes wrap the local upload URL with a 15-minute HS256 JWT whose `key` claim is the exact storage key. `/api/upload/local` is moved out of the blanket middleware guard and authorizes inside the route: photographer session **or** a token matching the decoded key. The token is bound to one path, expires quickly, and is never accepted for a different key (runtime-tested 401).

**Rejected.** Making `/api/upload/local` fully public (arbitrary key overwrite), and proxying bytes through the metadata route (phone memory/bandwidth). R2 presigned URLs are returned untouched.

## ADR-012: Batch selection endpoint instead of N PATCHes

**Context.** "Select All" on a 700-photo ceremony issued 700 concurrent PATCH requests from a phone browser, the same socket-exhaustion class as the upload history.

**Decision.** `POST /api/share/[token]/select` accepts `{photoIds, isSelected, password?}`, verifies the token/expiry/password, filters IDs to the album, updates in one SQL statement, and logs one activity event with a count. The client applies per-photo versioned optimistic updates and rolls all of them back if the single request fails.

**Rejected.** A public batch route under `/api/photos` (needs auth-context plumbing and is easier to abuse), and sequential per-photo requests (slow but still 700 round trips).

## ADR-013: Existence check before appending a ZIP entry

**Context.** `createReadStream` does not throw synchronously for a missing file; the stream emits `error` later. A missing original left the ZIP response open indefinitely (reproduced: 10 s client cap, partial output). `archive.finalize()` was also unawaited.

**Decision.** `fileExists(key)` (storage adapter) is checked before `getFileStream`; stream `error` is handled; `finalize()` is awaited and errors logged. Missing files are skipped with a warning, so one lost object cannot block the entire album download.

**Trade-off.** A download can succeed with fewer files than requested. The alternative (abort the whole ZIP) is worse for a client downloading a large album; the server log is the recovery path.

## ADR-014: Invalidate the vector cache on every destructive path

**Context.** `getAlbumVectorMatrix` caches album descriptors for 15 minutes; deletes did not invalidate it, so deleted photos could still be returned as matches with live presigned URLs.

**Decision.** Invalidate after single-photo delete, batch delete, ceremony delete, and album delete, in addition to the existing faces/reprocess hooks. The cache remains a pure read optimization; SQLite stays authoritative.

**Rejected.** Lowering the TTL (still leaves a window) and invalidating on a timer (does not fix correctness).

