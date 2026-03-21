# AGENTS.md — FotoHaven Implementation Guide

> This file is for AI agents (Claude Code, Cline) implementing new features.
> Every roadmap item has a self-contained spec: what to build, where it goes,
> what to touch, and acceptance criteria. Pick a task, read its spec, execute.

---

## How to use this file

1. User assigns a task (e.g. "implement per-photo comments")
2. Find the task below
3. Read the full spec — it lists every file to create/edit
4. Check `CLAUDE.md` for conventions before writing code
5. Execute, then verify against the acceptance criteria

---

## Task: Per-photo comments

**Status:** Completed  
**Scope:** Photographer can leave a text note on individual photos. Client can see notes.

### Schema changes (`prisma/schema.prisma`)
Add to `Photo` model:
```prisma
comments Comment[]
```

New model:
```prisma
model Comment {
  id        String   @id @default(uuid())
  body      String
  author    String   // "photographer" | "client" — no auth yet, honour-system
  photoId   String
  photo     Photo    @relation(fields: [photoId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
}
```

After schema edit run: `npx prisma generate && npx prisma db push`

### New API routes
- `POST /api/comments` — body: `{ photoId, body, author }`
- `GET /api/comments?photoId=uuid` — returns comments for a photo

Create: `src/app/api/comments/route.ts`

### UI changes
- `src/app/share/[token]/page.tsx` — add comment panel in photo lightbox
  - Input field + submit button
  - List existing comments below the photo
  - Call POST /api/comments on submit
  - Call GET /api/comments?photoId on lightbox open

- `src/app/albums/[albumId]/page.tsx` — show comment count badge on photos
  that have comments (small dot indicator)

### New types (`src/types/index.ts`)
```typescript
interface Comment {
  id: string;
  body: string;
  author: string;
  photoId: string;
  createdAt: string;
}
```

### Acceptance criteria
- [x] Photographer can type a comment in the lightbox and submit
- [x] Comment appears immediately below the photo (optimistic update)
- [x] Comment persists on page reload
- [x] Client dashboard shows a dot indicator on photos with comments
- [x] Comments cascade-delete when photo is deleted

---

## Task: Password-protected share links

**Status:** Completed  
**Scope:** Client can optionally set a password on an album. Photographer must enter it to view.

### Schema
`Album.password` field already exists (nullable String for bcrypt hash).
No schema change needed. Add `bcryptjs` package: `npm install bcryptjs @types/bcryptjs`

### API changes
- `POST /api/albums` — if `password` in body, hash it with bcrypt before saving:
  ```typescript
  import bcrypt from "bcryptjs";
  const hashed = await bcrypt.hash(body.password, 10);
  ```
- `GET /api/share/:token` — if album has a password:
  1. Check `Authorization: Bearer <password>` header OR
  2. Return `{ passwordRequired: true }` with status 401 if no header
  3. Verify with `bcrypt.compare(provided, album.password)`

### UI changes
- `src/app/albums/new/page.tsx` — Step 3 settings: add optional password field
- `src/app/share/[token]/page.tsx` — if 401 response, show password prompt screen
  before gallery renders. On submit, retry GET with password in Authorization header.

### Acceptance criteria
- [x] Albums without password work exactly as before (no regression)
- [x] Setting a password on creation stores a bcrypt hash (never plaintext)
- [x] Share link shows password prompt if album is protected
- [x] Correct password reveals the gallery
- [x] Wrong password shows error message, allows retry

---

## Task: Email notifications (Resend)

**Status:** Completed  
**Scope:** Client receives an email when their share link is first viewed.

### New dependency
`npm install resend`

### New env vars (add to `.env.example`)
```env
RESEND_API_KEY=           # from resend.com
NOTIFICATION_EMAIL=       # client's email to notify
```

### New file: `src/lib/email.ts`
```typescript
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendViewNotification(albumTitle: string, clientEmail: string) { ... }
```

### Schema change
Add to `Album`:
```prisma
notifyEmail   String?
firstViewedAt DateTime?
```

### API change
`GET /api/share/:token` — after successful auth:
- If `album.firstViewedAt` is null, set it to `now()` and send email
- This ensures only the first view triggers the notification

### Acceptance criteria
- [x] Email sent only on first view, not every view
- [x] Email contains album title and a link back to the share URL
- [x] No crash if `RESEND_API_KEY` is not set (log warning, skip silently)
- [x] `notifyEmail` is optional — albums without it skip notification

---

## Task: Upload-back flow

**Status:** Completed  
**Scope:** Photographer can upload edited finals back into the album. Client can download them.

### Schema change
Add to `Photo`:
```prisma
isReturn      Boolean  @default(false)   // true = edited return from photographer
returnOf      String?                    // photoId of the original (optional link)
```

### New API route
`POST /api/share/:token/upload` — same as `/api/upload` but:
- Authenticated by share token (not album owner)
- Sets `isReturn: true` on the created photo

### UI changes
- `src/app/share/[token]/page.tsx` — add "Upload Returns" section at the bottom:
  - Simple dropzone (same component pattern as album manager)
  - Shows returned photos in a separate "Delivered Finals" tab
- `src/app/albums/[albumId]/page.tsx` — show "Finals" badge on ceremonies
  that have returned photos

### Acceptance criteria
- [x] Photographer can upload from the share page without any account
- [x] Returned photos appear in a separate "Finals" section
- [x] Client can download returned photos as ZIP
- [x] Original and returned photos don't mix in the gallery

---

## Task: Health dashboard UI

**Status:** Not started  
**Scope:** A `/admin/health` page showing server status (only when running on Android).

### New page: `src/app/admin/health/page.tsx`
Display:
- PM2 process uptime (call a new `/api/admin/health` route)
- Disk usage
- Memory usage  
- DB file size
- Cloudflare Tunnel status (ping cloudflare API)
- Recent error log lines

### New API route: `src/app/api/admin/health/route.ts`
Returns JSON with system metrics. Uses Node.js `os` module and `fs.stat` for disk.
**Gate this behind `APP_SECRET`** — require `Authorization: Bearer {APP_SECRET}` header.

### Acceptance criteria
- [ ] Page shows real-time stats (auto-refreshes every 30s)
- [ ] Unauthenticated requests to `/api/admin/health` return 401
- [ ] Page shows "N/A" gracefully for metrics not available (e.g. on Vercel)
- [ ] Works on ARM (no native modules)

---

## Adding a new task

When the user asks to implement something not listed here:

1. Add a new `## Task:` section following the same format
2. Include: Status, Scope, Schema changes, New files, Modified files, New types, Acceptance criteria
3. Get user confirmation before executing
4. Mark `[x]` on acceptance criteria as you complete each one

---

## Task: Delete photo / album feature

**Status:** Completed
**Scope:** Photographer can delete an individual photo or an entire album from the admin interface. When deleting, the actual image files must be deleted from storage (R2/local).

### Schema change
None needed. `onDelete: 'cascade'` is already configured for ceremonies → albums and photos → ceremonies in Drizzle. Deleting an album from the database automatically cascades to its ceremonies, photos, and comments.

### New API routes
- `DELETE /api/photos/[photoId]` — `src/app/api/photos/[photoId]/route.ts`
  - Looks up the photo record.
  - Calls `deleteFile(photo.storageKey)`.
  - Deletes the photo from the database.
- `DELETE /api/albums/[albumId]` — `src/app/api/albums/[albumId]/route.ts`
  - Looks up all photos belonging to the album (via its ceremonies).
  - Iterates through the photos and calls `deleteFile(photo.storageKey)` for each.
  - Deletes the album from the database (cascade handles the rest).

### UI changes
- `src/app/albums/[albumId]/page.tsx`
  - Add a trash/delete icon to individual `PhotoCard` components (only visible to photographer).
  - Add a "Delete Album" button in the top header.
  - Use `confirm()` dialogues before executing the delete.
- `src/app/page.tsx`
  - Add a "Delete" button to the album cards on the dashboard.

### Acceptance criteria
- [x] Photographer can delete a single photo from the album management page
- [x] Photo is permanently removed from both the database and the `/data/uploads` folder
- [x] Photographer can delete an entire album
- [x] Deleting an album removes all of its associated photo files from the storage backend (no orphaned files left on disk)

---

## Task: Delete group of photos (multi-select)

**Status:** Completed
**Scope:** Photographer can select multiple photos in the album management view and delete them all at once.

### Schema change
None needed.

### New API routes
- `POST /api/photos/delete-batch` — `src/app/api/photos/delete-batch/route.ts`
  - Expects a JSON body with an array of `photoIds: string[]`.
  - Looks up the photo records to retrieve their `storageKey`s.
  - Iterates and calls `deleteFile()` on each one.
  - Deletes all matched photo records from the database in one query.

### UI changes
- `src/app/albums/[albumId]/page.tsx`
  - Add a state array `selectedPhotos` to track selected IDs.
  - Update `PhotoCard` to show a checkbox overlay (top-left) when in "selection mode" or on hover. 
  - Clicking a photo checks/unchecks it.
  - Show a floating action bar or banner when 1 or more photos are selected:
    - Displaying "X photos selected"
    - "Cancel Selection" button
    - "Delete Selected" button (calls `confirm()`, then hits the new endpoint)
  - After successful deletion, clear the selection state and refresh the album.

### Acceptance criteria
- [x] Photographer can select multiple photos from the album grid using checkboxes
- [x] A delete button is visible when 1 or more photos are selected
- [x] Deleting bulk removes all selected photos from both DB and `/data/uploads` folder
- [x] Album UI refreshes to show the remaining photos

---

## Task: Expose app to internet (Tailscale Funnel)

**Status:** Completed
**Scope:** Provide a free, permanent public URL for FotoHaven running on Android/Termux via Tailscale Funnel. Keep Cloudflare Tunnel as an alternative option.

### Schema change
None.

### New files
- `infra/android/tailscale-setup.sh` — One-shot setup script: installs Go, builds Tailscale from source, authenticates, enables Funnel, updates `.env.local`, creates boot script

### Modified files
- `README.md` — Step 7 rewritten with comparison table + Option A (Cloudflare) / Option B (Tailscale). Step 8 updated with dual boot script docs.
- `AGENTS.md` — This task spec added

### Key technical details
- `NEXT_PUBLIC_APP_URL` is only used server-side in `src/lib/storage.ts` — changing `.env.local` + `pm2 restart` is sufficient (no rebuild needed)
- Tailscale runs in Termux userspace (`--tun=userspace-networking`), no root required
- Funnel maps external `:443` → local `:3000` automatically
- Boot script at `~/.termux/boot/start-tailscale.sh` auto-starts daemon + funnel on reboot

### Acceptance criteria
- [x] Setup script installs and configures Tailscale Funnel end-to-end
- [x] README documents both Cloudflare Tunnel and Tailscale Funnel as options
- [x] Boot script created for auto-start on phone reboot
- [x] `npx tsc --noEmit` passes with zero errors
- [x] Existing Cloudflare Tunnel config preserved (no regression)

---

## Task: Android optimization for large photo handling

**Status:** Completed
**Scope:** Optimize FotoHaven to run reliably on a low-end Android device (6 GB RAM, root access) handling photos up to 25 MB each, exposed via Cloudflare Tunnel.

### Schema change
None.

### Modified files

#### `next.config.mjs`
- Added `serverExternalPackages: ['better-sqlite3']` (prevent native module bundling)
- Added `experimental.serverActions.bodySizeLimit: '25mb'`

#### `src/lib/db.ts`
- Enabled SQLite WAL mode (`PRAGMA journal_mode=WAL`)
- Set `busy_timeout=5000`, `cache_size=-8000`, `synchronous=NORMAL`, `temp_store=MEMORY`

#### `src/app/api/upload/local/route.ts`
- Replaced `req.arrayBuffer()` with streaming pipeline (`Readable.fromWeb → Transform → createWriteStream`)
- Added mid-stream size enforcement (25 MB limit)
- Added partial file cleanup on error
- Disabled Next.js body parsing (`export const dynamic = "force-dynamic"`)

#### `src/app/api/files/[...key]/route.ts`
- Added HTTP Range request support (206 Partial Content) for resumable downloads
- Added ETag header for conditional requests (304 Not Modified)
- Increased Cache-Control to 24h with `immutable` hint

#### `src/app/api/upload/route.ts` & `src/app/api/share/[token]/upload/route.ts`
- Reduced `MAX_SIZE` from 50 MB → 25 MB

#### `src/app/albums/[albumId]/page.tsx` & `src/app/share/[token]/page.tsx`
- Replaced `fetch()` upload with XHR for real-time upload progress
- Strict upload concurrency = 1 (one file at a time)
- Retry with exponential backoff (3 attempts)
- Added progress bar UI to upload queue items
- Updated size limit text (50 MB → 25 MB)

### Acceptance criteria
- [x] Uploads stream to disk — 25 MB photo uses ~64 KB heap (not 25 MB)
- [x] SQLite WAL mode enabled with busy_timeout for concurrent reads during writes
- [x] File serving supports Range requests (206 Partial Content) for resumable downloads
- [x] Upload concurrency strictly limited to 1 file at a time (prevents OOM)
- [x] Upload progress shown with real percentage and visual progress bar
- [x] Uploads retry up to 3 times with exponential backoff on network errors
- [x] Max file size reduced to 25 MB across all routes
- [x] `npx tsc --noEmit` passes with zero errors

---

## Task: Thumbnail Previews for Fast Gallery Loading

**Status:** Completed
**Scope:** Generate smaller (800px) JPEG thumbnails of uploaded photos to serve in gallery grids, while retaining original high-resolution files for downloads and lightbox viewing.

### Schema change
- Added `thumbnailKey` (nullable `String`) to the `Photo` model.

### Modified files

#### `next.config.mjs`
- Increased `experimental.serverActions.bodySizeLimit` to `30mb`.

#### `src/app/api/upload/route.ts` & `src/app/api/share/[token]/upload/route.ts`
- Increased `MAX_SIZE` from 25 MB → 30 MB.

#### `src/app/api/upload/local/route.ts`
- Increased `MAX_UPLOAD_BYTES` to 30 MB.
- Added `sharp` to process a downscaled `thumb_` prefixed copy right after stream ingestion.
- Updated database to write the `thumbnailKey` after `sharp` processing completes.

#### `src/app/api/share/[token]/route.ts` & `src/app/api/albums/[albumId]/route.ts`
- Updated `photos` JSON mapping to return `url` pointing to the presigned `thumbnailKey` (or falling back to `storageKey`) and `originalUrl` pointing to the full-resolution `storageKey`.
- Updated album deletion routes to also `deleteFile(photo.thumbnailKey)`.

#### `src/app/api/photos/[photoId]/route.ts` & `src/app/api/photos/delete-batch/route.ts`
- Updated to delete `photo.thumbnailKey` from storage alongside `photo.storageKey`.

#### UI View Pages
- Modified `Photo` interface to include `originalUrl?`.
- `share/[token]/page.tsx` & `albums/[albumId]/page.tsx` now use `originalUrl` for downloading zip archives.
- Lightbox view uses `originalUrl` when available to render high resolution in full screen.

### Acceptance criteria
- [x] Max upload size successfully bumped to 30MB across the board.
- [x] Local storage creates a `thumb_` prefixed file next to the original file.
- [x] Database is successfully updated with `thumbnailKey`.
- [x] Gallery grids load the thumbnail version (faster sizes) and Zip downloads/Lightbox use the original high quality version.
- [x] Deleting a photo also deletes the thumbnail from the filesystem.
- [x] TypeScript compiles without failing.

---

## Task: System Logging and Documentation Updates

**Status:** Completed
**Scope:** Implement API and Database logging to help with debugging across the full stack. Update project documentation (`CLAUDE.md`) to reflect the drastic recent architectural changes ensuring any AI agent has the latest, most accurate context.

### Schema change
None.

### New files
- `src/middleware.ts` — Next.js Edge middleware to intercept incoming requests and log `[API] {METHOD} {PATH}` to the console. Restricted to `/api/*` routes.

### Modified files

#### `src/lib/db.ts`
- Use Drizzle's `DefaultLogger` to capture and log every exact SQL query executed against the SQLite database, prefixed with `[DB]`.

#### `CLAUDE.md`
- Needs a full pass over the "Tech stack", "Data models", and "Android hosting context" sections:
  - Add documentation about WebAssembly `sharp` requirement for ARM64/Android.
  - Document the 30MB limit across server actions and uploads.
  - Mention Next.js streaming pipeline and file chunking rules.
  - Document new models (if any) and fields like `thumbnailKey`.

#### `README.md`
- Quick review to ensure deployment and feature list accurately mirrors reality (e.g. batch deletions, thumbnail generation).

### Acceptance criteria
- [x] Database queries are logged to stdout with a `[DB]` prefix.
- [x] All hit API endpoints correctly log out `[API] {METHOD} {PATH}`.
- [x] `CLAUDE.md` reflects modern features: Tailscale, thumbnail generation with `sharp`, 30MB stream uploads.
- [x] `npx tsc --noEmit` passes with zero errors.

---

## Task: Server-Side ZIP Streaming

**Status:** Not started
**Scope:** Replace client-side `JSZip` generation with server-side on-the-fly streaming using `archiver`. This prevents mobile browser crashes when downloading large albums.

### Schema change
None.

### New dependencies
`npm install archiver @types/archiver`

### New API routes
- `POST /api/share/[token]/download` — `src/app/api/share/[token]/download/route.ts`
  - Body (FormData): `photoIds` (JSON array of strings) and `bundleName` (string).
  - Queries database for `Photo.storageKey` matching the IDs.
  - Opens `archiver('zip', { zlib: { level: 0 } })`.
  - Streams local files into the archiver.
  - Returns `new Response(stream)` with `Content-Type: application/zip` and `Content-Disposition: attachment`.
- `POST /api/albums/[albumId]/download` — `src/app/api/albums/[albumId]/download/route.ts`
  - Same logic, used by photographer dashboard for downloading returned finals.

### UI changes
- `src/app/share/[token]/page.tsx` & `src/app/albums/[albumId]/page.tsx`
  - Remove all `JSZip` imports and client-side chunking logic.
  - Replace `downloadAll`, `downloadSelected`, `downloadCeremony`, and `downloadFinals` click handlers to programmatically submit a hidden `<form method="POST">` containing the required `photoIds` directly to the new `download` API routes.
  - This allows the browser to natively handle the download stream and show its own progress bar, completely wiping out browser memory usage.

### Acceptance criteria
- [ ] `JSZip` dependency removed or no longer loaded in browser
- [ ] Zips are generated strictly on the server and streamed using `archiver`
- [ ] Share page `Download All` and `Download Selected` triggers native browser download
- [ ] Album manager `Download Finals` triggers native browser download
- [ ] Zip generation uses `{ zlib: { level: 0 } }` to prevent CPU stalling on large JPEGs

---

## Task: Automate Cloudflare Tunnel URL

**Status:** Not started  
**Scope:** Automatically capture the randomized Quick Tunnel URL on startup, save it to `.env.local`, and restart the web server to reflect the newly assigned public URL.

### Schema change
None.

### New files
- `infra/android/start-cloudflare.sh` — Wraps `cloudflared`, intercepts the URL from `stderr`, injects into `.env.local`, and triggers a PM2 restart of `fotohaven`.

### Modified files
- `ecosystem.config.js` — Change the `cloudflared` script block to execute the new shell wrapper instead of the binary directly.

### Acceptance criteria
- [x] `.env.local` is automatically updated with the correct `NEXT_PUBLIC_APP_URL` every time `cloudflared` restarts.
- [x] PM2 automatically restarts the `fotohaven` process only when a *new* URL is generated.
- [x] PM2 effectively manages the script without crashing.
