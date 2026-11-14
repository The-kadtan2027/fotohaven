# FotoHaven — State-Machine Audit

Branch: `state-machine-audit` (created from `feat/python-face-recognition` @ `05cccbb`).
Date: 2026-11-14.
Scope: whole repository (`src/`, SQLite schema, background workers, Python face services, PWA).

## 0. Orientation

| Item | Value |
|---|---|
| Stack | Next.js 15.1.4 App Router, React 19, TypeScript 5, Tailwind 3 |
| State tooling | none (no XState/Redux/Zustand); implicit machines built from `useState` clusters, string enums, DB status columns |
| DB | SQLite via `better-sqlite3` + Drizzle, WAL (`src/lib/db.ts:10-19`) |
| Background work | hand-rolled SQLite `JobQueue` + single-process worker (`src/lib/job-runner.ts`) |
| Face services | browser `face-api.js` (`FaceProcessor.tsx`), FastAPI `native-face-service` (InsightFace/OpenCV), legacy `face-service` |
| Tests | none in repository (`find` for `*.test.*` / `*.spec.*` returned nothing) |
| Type check | `cmd /c npx tsc --noEmit` → exit 0 on baseline |
| Lint | `npm run lint` (`next lint`) |
| Build | `npm run build` |
| Run | `npm run dev` / `npm start`; PM2 config in `ecosystem.config.js` |

No test runner exists. Characterization tests for this work use Node's built-in test runner through the already-installed `tsx` (no new dependency).
Command after this change: `npm test` → `tsx --test tests/*.test.ts`.

### Explicit vs implicit machines

There are no explicit state-machine libraries. Every machine below is implicit and was reconstructed from code, not comments.

| # | Machine | Owner | Kind | Risk rank | Why |
|---|---|---|---|---|---|
| 1 | Guest face discovery | `src/app/share/[token]/guest/page.tsx`, `src/app/api/guest/*`, `src/app/api/recognize/route.ts` | implicit (string `step` + booleans) | 1 | auth boundary, face data, highest drop-off surface |
| 2 | Album upload pipeline | `src/app/albums/[albumId]/page.tsx`, `src/app/api/upload/route.ts`, `src/app/api/upload/local/route.ts` | implicit (`UploadStatus`, flags, effects) | 2 | irreversible DB/file divergence, duplicate photos |
| 3 | Share gallery access + selection | `src/app/share/[token]/page.tsx`, `src/app/api/share/*`, `src/app/api/photos/[photoId]/route.ts` | implicit (loading/error/password flags, Set) | 3 | privacy (password/expiry), persisted client intent |
| 4 | Share return uploads | `src/app/share/[token]/page.tsx`, `src/app/api/share/[token]/upload/route.ts` | implicit (`ReturnUploadStatus` array) | 4 | data integrity, dead-end retries |
| 5 | Auth / sessions | `src/app/login/page.tsx`, `src/app/api/auth/*`, `src/middleware.ts`, `src/lib/guest-auth.ts` | implicit | 5 | admin boundary, OTP boundary |
| 6 | Job queue | `src/lib/job-runner.ts`, `JobQueue` table | explicit status column | 6 | lost/stuck background work |
| 7 | Face enrollment & indexing | `FaceProcessor.tsx`, `/api/photos/[id]/faces`, `/api/admin/enroll/*`, Python services | implicit/status column | 7 | correctness of guest results |
| 8 | Album manager destructive actions | `src/app/albums/[albumId]/page.tsx`, `src/app/api/photos/*`, `src/app/api/ceremonies/*`, `src/app/api/albums/*` | implicit | 8 | irreversible deletes |
| 9 | PWA lifecycle | `public/sw.js`, `src/components/PwaInstaller.tsx` | implicit (install/offline) | 9 | stale/private cached data |
| 10 | New-album wizard | `src/app/albums/new/page.tsx` | implicit (`step` number) | 10 | setup correctness (expiry) |
| 11 | Health dashboard polling | `src/app/admin/health/page.tsx`, `/api/admin/health` | implicit timers | 11 | ops only |

Per-machine as-is/to-be diagrams, transition tables and UI contracts: `docs/state-machines/machines/`.

## 1. Cross-cutting observations

- The server is authoritative only for rows it owns. Several machines persist intent from the client optimistically with no rollback (selection, comments), and several server transitions trust the client (image hash, native face match IDs, download scope).
- The upload flow creates a `Photo` row **before** the bytes exist (`src/app/api/upload/route.ts:55-75`). This is a saga gap: failure of the second step leaves a phantom row, and retry creates a second row.
- Error states in the guest and share pages are rendered in the page body while a fixed overlay or a full-screen error branch is showing, so some errors are unreachable to the user (see F-09/F-01).
- Several `useEffect` bodies call functions whose state is not in the dependency list (upload auto-start, comments fetch); the resulting races are the class behind the historic upload fixes in git log (commits `a09fd7e`, `b130503`, `cee5e13`).
- No transition is logged with a correlation ID. Only API method/path (`src/middleware.ts:40-43`) and DB SQL are logged.

## 2. Findings (Phase 5)

Legend — status: **C** confirmed by code path, **L** likely (code path strongly implies, not executed), **S** suspected. Severity × likelihood is qualitative. "Fix" column maps to the implementation in this branch.

### Fix now (implemented in this branch)

| ID | Machine | Class | Evidence | Impact | Sev × Lik | Fix | Effort | Conf |
|---|---|---|---|---|---|---|---|---|
| F-01 | Share access | Bug | `src/app/share/[token]/page.tsx:98-135`: catch sets `error`; success path never clears it. Rendering at `:585` hides the album whenever `error` is set. | Wrong password, then correct password → "Link unavailable" forever (until reload). Blocks the whole gallery. | High × High | Clear error on every load; keep password error local | S | C |
| F-02 | Share access | UX gap | `src/app/share/[token]/page.tsx:139-158`: ceremony fetch failure is `console.error` only; `:778` renders "No photos in this ceremony yet". Retry only happens when `activeCeremony` or `password` changes (`:163-167`). | Network/502 looks like an empty album; no recovery. | Med × High | Per-ceremony error state + Retry | S | C |
| F-03 | Share selection | Design flaw | `src/app/share/[token]/page.tsx:170-181`: `persistSelection()` is called **inside** the `setSelectedPhotos` updater. React may invoke updaters twice; failures are only logged (`:88-95`). | Duplicate PATCH requests; UI says selected while DB says not; lost on reload. | Med × High | Reducer + per-photo versioned rollback + toast | M | C |
| F-04 | Share notes | Bug | `src/app/share/[token]/page.tsx:494-526`: fetch has no abort/stale check; `:528-552` waits for POST and uses `isSubmitting` state (two Enter presses in one tick both pass). | Notes can jump to another photo; double posts. | Med × Med | Abort + current-photo guard; optimistic temp row with rollback; ref lock | M | C |
| F-05 | Share download | Bug | `src/app/share/[token]/page.tsx:399-403` / `:790-800` builds finals IDs only from `ceremonyPhotos` (lazily loaded active ceremonies). `src/app/api/share/[token]/download/route.ts:29-35` has no `finals` scope. | "Download Finals" silently omits finals in unopened ceremonies. | Med × High | New `scope=finals` server-side selection | S | C |
| F-06 | Share download | Security | `src/app/api/share/[token]/download/route.ts:1-30`: no expiry and no password check, unlike the album/ceremony routes. Any token holder (or anyone with a leaked token after expiry) downloads originals. | Password/expiry bypass, irreversible data egress. | High × Med | Enforce expiry + bcrypt password (form field or Bearer) | S | C |
| F-07 | Share return upload | Security | `src/app/api/share/[token]/upload/route.ts:22-36`: checks expiry but never password. | Anyone with the share token can inject files into a protected album. | High × Med | Require album password when set | S | C |
| F-08 | Share ceremony photos | Security | `src/app/api/share/[token]/ceremonies/[ceremonyId]/photos/route.ts:42-47`: queries by `ceremonyId` alone; album is used only for password/expiry. | Any valid token fetches another album's ceremony photos (cross-tenant data leak). | High × Med | Join ceremony → album and require `albumId === album.id` | S | C |
| F-09 | Guest discovery | UX gap / trap | `src/app/share/[token]/guest/page.tsx:293-364`: scan stops the camera at `:308`; failure sets `error` at `:361`, but the scan overlay (`:764+`) covers the page and renders no error. Shutter stays disabled (`cameraReady=false`). | Guest is stuck on a black full-screen view with no way forward except browser back. | High × High | Error + actions inside overlay (`Retry camera`, `Upload`, `Back`) | M | C |
| F-10 | Guest discovery | Bug | `src/app/share/[token]/guest/page.tsx:316-327`: `enroll-face` response is not checked in the native path, then `loadMatchedPhotos` throws if enrollment failed. | Generic "Failed to load matches"; face descriptor silently not saved. | Med × Med | Check response, throw actionable error | S | C |
| F-11 | Guest discovery | UX gap | `src/app/share/[token]/guest/page.tsx:203-213`: returning guest with a descriptor calls `loadMatchedPhotos`; on failure `error` is set but `step` stays `otp`. | Error appears under the OTP form; user re-verifies repeatedly. | Med × Med | Transition to results-with-error + rescan CTA | S | C |
| F-12 | Guest auth | Hardening | `src/app/api/guest/request-otp/route.ts:51-100` and `verify-otp/route.ts:69-98`: no rate limit, no failed-attempt counter; 6-digit code valid 10 min. | OTP brute force (10^6/10 min) and email-spam amplification. | High × Med | In-memory sliding-window limiter (3 sends / 10 min, 5 verify failures / 10 min) | S | C |
| F-13 | Upload pipeline | Bug | `src/app/albums/[albumId]/page.tsx:269-276` auto-starts `uploadAll`; `uploadAll` has no in-flight lock and includes `error` items (`:338`). A manual click in the same tick can start a second loop. | Duplicate uploads/rows for the same file; retry storms. | High × Med | `useRef` mutex + reducer status machine; retry only explicit | M | C |
| F-14 | Upload pipeline | Bug | `src/app/api/upload/route.ts:55-75`: row inserted before upload; `src/app/albums/[albumId]/page.tsx:348-379` has no compensation when XHR fails. | Phantom photos (broken thumbnails), retries create additional rows; orphan rows survive forever. | High × High | Track `photoId`, DELETE it on failed upload and on queue removal | M | C |
| F-15 | Upload pipeline | Bug | `src/app/albums/[albumId]/page.tsx:181-203`: `onDrop` falls back to `activeCeremony`/first ceremony when auto-creation failed. | Folder photos land in the wrong ceremony silently. | Med × Med | Mark item as error when a resolved folder has no ceremony | S | C |
| F-16 | Album manager | Bug | `src/app/albums/[albumId]/page.tsx:131-158`: `fetchAlbum` returns without `setLoading(false)` for non-OK non-401. | 404/500 album shows an infinite spinner; "Album not found" branch (`:687`) unreachable. | Med × High | Error state + Retry; set loading in `finally` | S | C |
| F-17 | Face enrollment | Bug / trap | `src/app/albums/[albumId]/page.tsx:608-641`: `while (!done)` with 2 s polling has no deadline or unmount guard. | Stuck "Processing…" forever if the service reports `running:true`; setState after navigation. | Med × Med | 10-minute deadline + cancellation flag | S | C |
| F-18 | Dashboard | Bug | `src/app/page.tsx:39-48`: `.then(r => r.json())` without `r.ok`; `setAlbums(data)` can set an `{error}` object, then `albums.reduce` at `:156` throws. | Session expiry / 500 during dashboard load crashes the page. | High × Med | Validate array, redirect on 401, error UI + retry | S | C |
| F-19 | Dashboard QR | Bug | `src/app/page.tsx:80-91`: renders QR from a `setTimeout(50)` after state change. | Blank QR when the modal is slow to mount; race on first open. | Low × Med | Render in `useEffect` keyed on `qrToken` with a canvas ref | S | C |
| F-20 | New-album wizard | Bug | `src/app/albums/new/page.tsx:330` sends `expiresAt` (YYYY-MM-DD); `src/app/api/albums/route.ts:41` does `new Date(...)` → UTC midnight. | Link expires at 05:30 IST on the chosen day, not end of day; dashboard says "Expired" that morning. | Med × High | Send local end-of-day ISO; clear errors on step change | S | C |
| F-21 | File serving | Security + Bug | `src/app/api/files/[...key]/route.ts:46-52`: `startsWith(base)` prefix check accepts sibling dirs (`/…/fotohaven2`); `:117` and `:132` stream `resolved` even when `finalPath` was used for `stat`. | Path traversal to sibling roots; extension-fallback responses read a missing file → 500/empty. | High × Low (traversal) / Med × Med (fallback) | `resolveStoragePath()` with `path.sep`; stream `finalPath` | S | C |
| F-22 | Job queue | Bug | `src/lib/job-runner.ts:100-168`: failure sets `pending` immediately; pending query has no "not before" filter. `:184-186` re-triggers at once. | Failed jobs retry in a tight loop, burning CPU/disk on a phone; no backoff despite the comment in AGENTS. | Med × Med | Persist a due time in `updatedAt`, filter pending by due time, exponential backoff | M | C |
| F-23 | Face indexing | Bug | `src/app/albums/[albumId]/FaceProcessor.tsx:25-38`: a rejected `modelLoadPromise` is cached forever. `:231-249` keeps the "Processing faces (0/N)" banner after a fatal load failure. | After a transient 404/offline, faces never process for the rest of the session; no retry. | Med × Med | Reset promise on rejection; fatal error state + Retry/Dismiss | S | C |
| F-24 | PWA | Bug | `public/sw.js:11-25`: `cache.addAll(STATIC_ASSETS)` is atomic; `/globals.css` (line 7) is not a route in Next.js App Router, so the whole pre-cache rejects and is swallowed. | No app-shell pre-cache; offline fallback claims are false for unvisited pages. | Med × High | Remove bogus asset; per-entry `cache.add`; bump cache version | S | C |
| F-25 | PWA | Security | `public/sw.js:74-91`: Network-First caches **all** successful API GETs, including `/api/guest/my-photos` and `/api/auth/me`. | Face-match results and guest identity persist in Cache Storage on shared devices; stale after logout/session expiry. | Med × Med | Exclude `/api/auth`, `/api/admin`, `/api/guest`, `/api/recognize`; honor `no-store` | S | C |
| F-26 | Album detail API | Security hygiene | `src/app/api/albums/[albumId]/route.ts:32-44` spreads the whole album (bcrypt `password`) and activities with full `guest` rows (`sessionToken`). | Admin JS/state contains password hash and guest session tokens; any XSS or devtools leak escalates. | Med × Med | Strip `password`; select guest id/name/email only | S | C |
| F-27 | Guest matches | Security | `src/app/api/guest/my-photos/route.ts:305-359`: `nativeMatches`/`nativePhotoIds` come from the guest-controlled cookie payload and are looked up by ID without album scoping. | A guest who edits their enrolled payload can get presigned URLs/metadata for photos of other albums (IDOR). | High × Low | Join photos → ceremonies and filter `albumId = guest.albumId` | S | C |
| F-28 | Face thresholds | Bug | `src/app/api/admin/events/[id]/thresholds/route.ts:42-58`: cross-field `low < high` is validated only when **both** are sent. | API caller can persist `low > high`, an impossible state that breaks match bands. | Low × Med | Load current row and validate the merged pair | S | C |
| F-29 | Auth | Hardening | `src/app/api/auth/login/route.ts:15-37`: unlimited password attempts; `src/middleware.ts` no limiter. | Credential stuffing on the admin boundary. | High × Low | 5 failures / 15 min per IP+username → 429 | S | C |
| F-30 | Share return uploads | UX gap | `src/app/share/[token]/page.tsx:386-404`: only `pending` items are uploaded; failed items have no Retry and cannot re-enter the queue. Metadata POST is repeated on manual retry → duplicate rows. | Dead-end error; or duplicate finals if a workaround is used. | Med × Med | Per-item Retry reusing metadata; error copy + remove | M | C |

### Redesign (structurally unsound; addressed by the new machines)

| ID | Machine | Class | Evidence | Impact | Fix |
|---|---|---|---|---|---|
| R-01 | Guest discovery | Design flaw | One 1689-line component mixes OTP, consent, scanning, review, results and lightbox in a flat `step` string plus 20 booleans (`guest/page.tsx:61-89`). `busy` is shared by OTP and matching; overlay errors are unreachable. | Impossible combinations (`busy` in `results`, `error` on hidden step); every new branch is a regression risk. | Typed transition helpers + overlay-local error state (implemented as `GuestScanError` UI + guarded transitions; full reducer deferred, see ADR). |
| R-02 | Share selection | Design flaw | Optimistic store with no versioning (`page.tsx:170-181`). | Out-of-order PATCH responses can roll back a newer intent. | `selection-machine.ts` reducer with per-photo version (implemented). |
| R-03 | Upload pipeline | Design flaw | Two writers (`onDrop`, auto-effect, retry) mutate one flat array; no claim/lease on items. | Duplicate in-flight work; impossible statuses (`done` retained, `uploading` without lock). | `upload-queue.ts` reducer + mutex (implemented). |
| R-04 | Job queue | Design flaw | Status column but no `runAt`, no lease owner; recovery uses `updatedAt` for two meanings. | Two workers (PM2 cluster scale-up) would both claim; retries are unbounded in frequency. | Backoff via due-time (implemented, single-instance documented in ADR). |

### Later (reported, not changed)

| ID | Machine | Class | Evidence | Impact | Why deferred |
|---|---|---|---|---|---|
| L-01 | Auth | Hardening | `.env.example` line `RESEND_API_KEY` contains a live-looking key (38 chars); `.env` and `dev.db` are tracked (`git ls-files`). | Secret leakage; dev DB in git. | Must be rotated by the owner; touching secrets is out of scope. Remove from tracking in a separate, owner-approved change. |
| L-02 | Guest discovery | UX gap | `guest/page.tsx:764-999` scan overlay has no `role="dialog"`, no focus trap, no Escape; camera errors are text only. | Screen-reader/keyboard guests cannot operate the camera step. | Accessibility pass on the overlay. |
| L-03 | All toasts/modals | Accessibility | `src/components/ToastProvider.tsx:54-62, 178-260`: no `role="status"`/`aria-live`, confirm has no `role="dialog"`/`aria-modal`, Escape does not dismiss confirm. | State changes are silent to assistive tech. | Component-level a11y pass. |
| L-04 | Share lightbox | Accessibility | `src/app/share/[token]/page.tsx:1040-1160`: no `role="dialog"`, arrows are unlabelled icon buttons, focus not moved. | Keyboard-only users lose context. | Lightbox a11y pass. |
| L-05 | Health dashboard | Hardening | `src/app/api/admin/health/route.ts:23-68, 120-176`: `execSync` (`pm2 jlist`, `df`, `pgrep`) on every 30 s poll; `page.tsx:187-204` can overlap requests. | Blocks the Node event loop on a phone; stale/overlapping refreshes. | Move to async/`execFile` with cache; poll lock. |
| L-06 | Upload | Design | `compressionConcurrency` UI (`albums/[albumId]/page.tsx:836-841`) has no effect; `mapWithConcurrency` (`:1193`) is dead. Compression is deliberately sequential to avoid memory pressure. | Users believe they changed performance; dead code. | Implemented removal (smallest fix), documented in ADR. |
| L-07 | Guest matching | Design | `guest/page.tsx:163-167, 451-499`: a returning guest never gets the Quick Review wizard (`!isReturningGuest` guard). | Refinement path unavailable on second visit; by design in the last task but inconsistent. | Product decision needed. |
| L-08 | Middleware | Security | `src/middleware.ts:40-51`: unauthenticated `PATCH` is allowed for all `/api/photos/*`, including `imageHash` (`api/photos/[photoId]/route.ts:65-72`). | A leaked photo ID can poison the duplicate index. | Restrict unauth PATCH body to `isSelected`; needs route-level auth context. |
| L-09 | Guest OTP | Data lifecycle | `guestOtps` rows are never pruned; expired rows accumulate. | Slow DB growth on a phone. | Retention job. |
| L-10 | Album delete | Observability | Deletes log only after success (`api/albums/[albumId]/route.ts:140-166`); no activity log; no dead-letter if storage deletion partially fails. | Silent partial deletes. | Ops/runbook task. |
| L-11 | Rate limiting | Ops | In-memory limiter added by this audit resets on PM2 restart and is per instance. | Bypass by restart; ineffective if scaled. | Redis/SQLite-backed limiter if instances > 1. |

## 3. Assumptions (decisions taken where the code is ambiguous)

1. **Single app instance.** `ecosystem.config.js` runs `instances: 1`, so an in-process rate limiter and the single job worker are acceptable for this deployment. If the app is ever scaled, the limiter and job claim logic must move to SQLite/Redis (ADR-004, ADR-006).
2. **Share password transport.** The share password is sent as a hidden form field for downloads and in the JSON body for return uploads. Both run over the same HTTPS origin as the page that already holds the password in React state. This does not weaken the existing model (the password is already sent to `GET /api/share/:token`); it extends the same check to the previously unprotected endpoints.
3. **Expiry is end-of-day local.** The wizard now converts the chosen date to the user's local `23:59:59.999` before sending. Existing rows are untouched; they keep their UTC-midnight semantics.
4. **Upload compensation is best-effort.** When an XHR upload fails after the metadata POST, the client calls the existing authenticated `DELETE /api/photos/:id` to remove the phantom row/files. If the tab is closed before compensation, a phantom row remains; the job/ops follow-up (L-10) is the safety net. No schema change was made.
5. **No new state library.** A typed reducer plus discriminated unions is sufficient; adding XState would be a new dependency without a repo precedent (ADR-002).
6. **Tests use `tsx --test`.** Node 24 + the existing `tsx` dev dependency; no Jest/Vitest/jsdom added. Component render tests are out of scope; pure machines and helpers are tested.
7. **Public API/DB compatibility.** No route shapes or tables changed except additive form fields (`password`, `scope=finals`) and removal of sensitive keys from the admin album response. No schema migration required.
8. **`GUEST_OTP_BYPASS`** remains an explicit escape hatch and is reported, not removed; enabling it in production is a deployment error, not a code state.

## 4. Verification (Phase 8)

Filled after implementation; see bottom of this file.

## 5. Transition coverage summary

Per-machine state × event matrices are in `machines/*.md`. Summary of the changed machines:

| Machine | States (to-be) | Events | Covered by tests | Ignored by design | Untested |
|---|---|---|---|---|---|
| Upload queue | `pending, uploading, error, done→removed` | ENQUEUE, START, PROGRESS, SUCCEED, FAIL, RETRY, REMOVE | reducer: all transitions + impossible event no-ops | PROGRESS in non-uploading state | network timing (manual) |
| Share selection | `idle, pending(version), confirmed, rolled-back` | TOGGLE, PATCH_OK, PATCH_FAIL, REPLACE, CLEAR | reducer: rollback, stale-version ignore, replace | PATCH_OK for replaced state | browser double-click (manual) |
| Job queue | `pending(due), processing(lease), completed, failed` | ENQUEUE, CLAIM, COMPLETE, FAIL, RECOVER, ADMIN_RETRY | retry delay helper | malformed payload (still retried, then failed) | crash mid-job (manual) |
| Guest scan overlay | `idle, camera_ready, capturing, error` | START_CAMERA, CAMERA_READY, CAMERA_DENIED, CAPTURE, FAIL, RETRY, BACK | transition helper | CAPTURE while busy | real camera (manual) |

## 6. Before / after

| Metric | Before | After |
|---|---|---|
| Explicit reducers | 0 | 3 (`upload-queue`, `selection-machine`, `guest-scan` helper) |
| Boolean clusters removed | — | upload `isUploading` remains UI-only; scan error state local |
| Defects closed | — | F-01…F-30 except reported-only items |
| Tests | 0 | see `npm test` output below |
| New dependencies | — | none |
| Schema changes | — | none |
