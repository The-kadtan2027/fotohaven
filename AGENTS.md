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

Implementation note:
- The remaining unchecked bullets in this section were completed in code on this branch:
- Duplicate grouping honors the configurable threshold.
- Admin blur styling stays album-only.
- Album and share lightboxes both use progressive thumbnail-to-full-resolution loading.

---

## Task: Server-Side ZIP Streaming

**Status:** Completed
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
- [x] `JSZip` dependency removed or no longer loaded in browser
- [x] Zips are generated strictly on the server and streamed using `archiver`
- [x] Share page `Download All` and `Download Selected` triggers native browser download
- [x] Album manager `Download Finals` triggers native browser download
- [x] Zip generation uses `{ zlib: { level: 0 } }` to prevent CPU stalling on large JPEGs

---

## Task: Automate Cloudflare Tunnel URL

**Status:** Completed  
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

---

## Task: Add/Delete Ceremonies & 100MB Uploads

**Status:** Completed
**Scope:** Increase maximum photo sizes to 100MB. Add controls to the album manager allowing photographers to dynamically add new ceremony folders or delete entire ceremony folders (wiping photos safely from disk).

### Schema change
None. Database cascade is correctly configured.

### New API routes
- `POST /api/ceremonies` — accepts `{ albumId, name }` to create a new ceremony.
- `DELETE /api/ceremonies/[ceremonyId]` — fetches all nested photos, deletes the objects from `storageKey` and `thumbnailKey` respectfully, then cascades deletion.

### Modified files
- `next.config.mjs` — Increase `bodySizeLimit` to `100mb`.
- `src/app/api/upload/route.ts` & analogues — Increment internal `MAX_SIZE` traps to `100 * 1024 * 1024`.
- `src/app/albums/[albumId]/page.tsx` — Introduce intuitive UI controls attached to the ceremony Tab switcher for "Add" and "Delete".

### Acceptance criteria
- [x] Maximum photo upload size succeeds at safely capturing 100MB files sequentially.
- [x] "Add Ceremony" drops a new functional folder into the album view.
- [x] "Delete Ceremony" deletes all interior folder data off the disk, deletes the DB row, and reverts the UI safely.

---

## Task: Photographer login / logout

**Status:** Completed  
**Scope:** Add real authentication so only a registered photographer can access the admin dashboard (`/`, `/albums/*`). Public share links remain unauthenticated.

### New dependency
`jose` — Edge-compatible JWT library (works in Next.js middleware which runs on the Edge runtime).

### New env vars (add to `.env.local`)
```env
JWT_SECRET=            # 32+ char random string (openssl rand -hex 32)
ADMIN_USERNAME=        # e.g. "admin"
ADMIN_PASSWORD=        # plain-text, only used by seed script to hash + insert
```

### Schema change (`src/lib/schema.ts`)
New table — append after existing tables:
```typescript
export const photographers = sqliteTable('Photographer', {
  id:           text('id').primaryKey(),
  username:     text('username').notNull().unique(),
  passwordHash: text('passwordHash').notNull(),
  createdAt:    integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});
```

After schema edit run: `npm run db:generate && npm run db:push`

### New API routes

#### `POST /api/auth/login` — `src/app/api/auth/login/route.ts`
- Body: `{ username, password }`
- Looks up `photographers` table by `username` (via Drizzle + `db.ts`)
- Verifies password with `bcryptjs.compare()`
- On success: creates a JWT (signed with `JWT_SECRET`, 7-day expiry, payload: `{ sub: photographer.id, username }`) using `jose`, sets it as an `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` cookie named `session`
- Returns `200 { ok: true }`
- On failure: returns `401 { error: "Invalid credentials" }`

#### `POST /api/auth/logout` — `src/app/api/auth/logout/route.ts`
- Clears the `session` cookie (set `maxAge=0`)
- Returns `200 { ok: true }`

#### `GET /api/auth/me` — `src/app/api/auth/me/route.ts`
- Reads `session` cookie, verifies JWT with `jose`
- Returns `200 { id, username }` if valid
- Returns `401 { error: "Not authenticated" }` if missing/invalid

### Middleware changes (`src/middleware.ts`)
Extend the existing Edge middleware to:
- Keep the existing `[API]` logging for `/api/*` routes
- Guard browser routes: `/`, `/albums`, `/albums/*` — if no valid `session` cookie, redirect to `/login`
- Guard API routes: `/api/albums`, `/api/albums/*`, `/api/upload`, `/api/upload/*`, `/api/photos`, `/api/photos/*`, `/api/ceremonies`, `/api/ceremonies/*` — if no valid `session` cookie, return `401 { error: "Unauthorized" }`
- **Do NOT guard**: `/api/auth/*`, `/api/share/*`, `/api/comments/*`, `/api/files/*`, `/login`, `/share/*`
- JWT verification uses `jose` (Edge-compatible) — **no** `better-sqlite3` or Node-only imports
- Update `config.matcher` to cover both `/api/:path*` and the admin pages

### New page: `src/app/login/page.tsx`
- Simple username + password form styled in the existing FotoHaven aesthetic (Cormorant Garamond heading, DM Sans body, dark palette)
- On submit: `POST /api/auth/login` with JSON body
- On success (200): `router.push('/')`
- On failure (401): show inline error message, allow retry
- Show a subtle "FotoHaven" branding / logo

### Seed script: `scripts/seed.ts`
- Reads `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `process.env` (loaded from `.env.local`)
- Hashes the password with `bcryptjs`
- Upserts one `Photographer` record into the database (insert if not exists, update hash if exists)
- Wire up in `package.json` as: `"seed": "npx tsx scripts/seed.ts"`

### Modified files summary
| File | Change |
|------|--------|
| `src/lib/schema.ts` | Add `photographers` table |
| `src/middleware.ts` | Add JWT verification + route guarding |
| `package.json` | Add `jose` dep, add `"seed"` script |
| `.env.example` (if it exists) | Add `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` |

### New files summary
| File | Purpose |
|------|---------|
| `src/app/api/auth/login/route.ts` | Login endpoint |
| `src/app/api/auth/logout/route.ts` | Logout endpoint |
| `src/app/api/auth/me/route.ts` | Session check endpoint |
| `src/app/login/page.tsx` | Login UI page |
| `scripts/seed.ts` | One-shot admin user seeder |

### Files NOT touched
- `src/lib/storage.ts` — no file I/O
- `src/lib/db.ts` — no changes needed (already exports the Drizzle client)
- `src/app/share/*` — share links remain public
- `src/app/api/share/*` — share API remains public
- `src/app/api/comments/*` — comments remain public (honour-system author field)

### Acceptance criteria
- [x] `jose` package is installed and used for JWT in middleware (Edge-compatible)
- [x] `photographers` table exists in schema with `id`, `username`, `passwordHash`, `createdAt`
- [x] `POST /api/auth/login` returns 200 + sets HttpOnly `session` cookie on valid credentials
- [x] `POST /api/auth/login` returns 401 on invalid credentials
- [x] `POST /api/auth/logout` clears the session cookie
- [x] `GET /api/auth/me` returns photographer info when authenticated
- [x] Unauthenticated browser request to `/` redirects to `/login`
- [x] Unauthenticated browser request to `/albums/*` redirects to `/login`
- [x] Unauthenticated API request to `/api/albums` returns 401
- [x] Share links (`/share/*`, `/api/share/*`) work without any login
- [x] Login page has proper FotoHaven styling (not a plain HTML form)
- [x] `scripts/seed.ts` creates a photographer from `ADMIN_USERNAME` + `ADMIN_PASSWORD` env vars
- [x] `npm run seed` is wired up in `package.json`
- [x] `npx tsc --noEmit` passes with zero errors

---

## Task: Photo selection by client

**Status:** Completed  
**Scope:** Client can star/select individual photos on the share page. Selections persist in the database so the photographer can see "Client has selected N of M photos" in the album manager.

### Schema change (`src/lib/schema.ts`)
Add `isSelected` to the `photos` table:
```typescript
isSelected: integer('isSelected', { mode: 'boolean' }).notNull().default(false),
```

After schema edit run: `npm run db:generate && npm run db:push`

### New API route

#### `PATCH /api/photos/[photoId]` — `src/app/api/photos/[photoId]/route.ts`
Add a `PATCH` handler to the existing file (which already has `DELETE`):
- Body: `{ isSelected: boolean }`
- Look up the photo by `photoId`. If not found, return `404`.
- Update `photos.isSelected` for that record.
- Return `200 { ok: true }`.
- **No auth required** — called from the unauthenticated share page.

### API changes (data mapping)

#### `GET /api/albums/[albumId]/route.ts`
- In the photo spread inside `albumWithUrls`, pass through `isSelected` from the DB row (it's already included via the Drizzle query spread — no extra query needed, just confirm it's not stripped).

#### `GET /api/share/[token]/route.ts`
- Same as above — `isSelected` is included in the Drizzle result and will be spread into the photo object automatically; no code change needed unless the field is explicitly omitted.

### Types (`src/types/index.ts`)
Add `isSelected` to the `Photo` interface:
```typescript
isSelected?: boolean;
```

### Share page UI (`src/app/share/[token]/page.tsx`)

**Current state:** The page already has a `selectedPhotos: Set<string>` state and `toggleSelect()` function wired to the `GalleryPhoto` checkbox — but this is ephemeral (lost on refresh) and used only for download selection.

**Changes needed:**
1. Add `isSelected` to the local `Photo` interface (line ~14).
2. On album load, initialise `selectedPhotos` from `photo.isSelected === true` across all ceremonies — so the set is pre-populated from the DB on mount.
3. Extend `toggleSelect(photoId)` to also call `PATCH /api/photos/:id` with `{ isSelected: !prev.has(photoId) }` — fire-and-forget (optimistic update, log error if it fails).
4. Add a live counter in the hero header — e.g. alongside the existing `"{totalPhotos} photos"` line, show `· Client selected: N` when `selectedPhotos.size > 0`. Alternatively, add a subtle sticky badge. Keep it unobtrusive.
5. No changes to download logic — `downloadSelected()` already uses `selectedPhotos` which will now reflect persisted selections.

### Album manager UI (`src/app/albums/[albumId]/page.tsx`)

**Current state:** The album page shows originals count and Finals badge on ceremony tabs. The PhotoCard shows checkboxes for bulk-delete selection only.

**Changes needed:**
1. Add `isSelected` to the local `Photo` interface (line ~12).
2. Add a "Client selected" summary line in the ceremony header area — e.g.: `"Client has selected {N} of {M} original photos."` — derived from `activeCeremonyData.photos.filter(p => !p.isReturn && p.isSelected).length`. Show only when N > 0.
3. Add a small gold star `★` overlay (bottom-right corner of each photo card) when `photo.isSelected === true` in `PhotoCard`. This is read-only on the admin side — no click handler needed. Position it opposite the existing comment dot indicator (top-right) to avoid overlap.
4. In the ceremony sidebar tab, optionally add a "S:N" micro-badge (like the FINALS badge) when any photo in that ceremony is selected.

### Download route — no changes needed
`POST /api/share/[token]/download` already accepts any `photoIds` array from the client. The client's persistent selection is just a pre-populated starting point for the existing download-selected flow. ✅ Confirmed: no change to the download route.

### Modified files summary
| File | Change |
|------|--------|
| `src/lib/schema.ts` | Add `isSelected` boolean field to `photos` table |
| `src/app/api/photos/[photoId]/route.ts` | Add `PATCH` handler |
| `src/app/api/albums/[albumId]/route.ts` | Confirm `isSelected` passes through (no-op if spread includes it) |
| `src/app/api/share/[token]/route.ts` | Same confirmation |
| `src/types/index.ts` | Add `isSelected?: boolean` to `Photo` |
| `src/app/share/[token]/page.tsx` | Pre-populate selection from DB, call PATCH on toggle, show counter |
| `src/app/albums/[albumId]/page.tsx` | "Client selected N of M" summary + star overlay on PhotoCard |

### Files NOT touched
- `src/lib/storage.ts` — no file I/O
- `src/lib/db.ts` — no changes
- `src/app/api/share/[token]/download/route.ts` — no changes
- `src/app/api/photos/delete-batch/route.ts` — no changes

### Acceptance criteria
- [x] `isSelected` column exists in the `Photo` DB table (boolean, default false)
- [x] `PATCH /api/photos/[photoId]` with `{ isSelected: true/false }` persists the value
- [x] `PATCH /api/photos/[photoId]` returns 404 if the photo does not exist
- [x] Share page checkboxes pre-populate from `photo.isSelected` on load (survives refresh)
- [x] Clicking a checkbox on the share page calls PATCH optimistically (no spinner, instant UI update)
- [x] Share page shows a live "Selected: N" counter when any photos are selected
- [x] Album manager shows "Client has selected N of M original photos" when N > 0
- [x] Album manager `PhotoCard` shows a gold star overlay on client-selected photos
- [x] Download-selected on the share page correctly uses the persisted selection as its default
- [x] `npx tsc --noEmit` passes with zero errors

---

## Task: Admin dashboard

**Status:** Completed  
**Scope:** A UI-only upgrade to the existing album list (`src/app/page.tsx`). No new API routes. Incorporates auth state and client selection summaries.

### Architectural approach (`src/app/page.tsx`)
- Since the spec mandates "All DB access indirectly via existing API routes, not direct DB calls from page components", and fetching intra-app API routes from Server Components requires passing session cookies and resolving absolute URLs (which is brittle), `page.tsx` will remain a `"use client"` component.
- This allows natural interaction with the `GET /api/albums` and `GET /api/auth/me` protected routes, and instant UI updates after deletions.

### Dependencies
- **Auth (Feature 1)**: The page will fetch `GET /api/auth/me` on mount. If it returns 401, redirect to `/login`.
- **Selections (Feature 4)**: The page will calculate total selections by summing `isSelected === true` across all photos in all ceremonies in the `GET /api/albums` response.

### UI changes (`src/app/page.tsx`)

#### Header
- Show photographer's username retrieved from `/api/auth/me`.
- Add a **Logout** button that calls `POST /api/auth/logout` and redirects to `/login`.
- Maintain existing "FotoHaven" branding and "New Album" CTA.

#### Stats Row (New)
- Top-level summary cards below the hero text:
  - **Total Albums**: `albums.length`
  - **Total Photos**: Sum of all photo counts
  - **Client Selections**: Sum of all `isSelected` photos across all albums.

#### Album Cards Update
Enhance the existing card map (`albums.map`) to include:
- **Title and Client Name** (existing)
- **Ceremony Count and Photo Count** (existing)
- **First Viewed Status**:
  - If `firstViewedAt` exists, show "Viewed on [date]"
  - Else show "Not yet viewed".
- **Expiry Badge**:
  - Green if >7 days remaining until `expiresAt`.
  - Amber if ≤7 days remaining.
  - Red if expired (or expiring today).
- **Selection Summary**: "Client selected N of M photos" (derive N from `isSelected` photos, M from non-`isReturn` photos).
- **Action Buttons**:
  - **Copy Link**: Existing clipboard functionality.
  - **Manage**: Links to `/albums/[albumId]`.
  - **Delete**: Existing prompt and DELETE call.

#### Empty State
- Show a friendly "No albums yet" prompt (keep existing `EmptyState` component or polish it).

### Acceptance criteria
- [x] Dashboard is restricted to authenticated photographers (redirects to `/login` if `/api/auth/me` fails).
- [x] Header shows the photographer's username and a working Logout button.
- [x] Stats row correctly aggregates total albums, total photos, and total `isSelected` client selections.
- [x] Album cards display `firstViewedAt` status cleanly.
- [x] Album cards display color-coded expiry badges based on days remaining.
- [x] Album cards show "Client selected N of M photos" accurately deriving from the API payload.
- [x] `npx tsc --noEmit` passes with zero errors.

---

## Task: Guest face-based photo discovery

**Status:** Completed  
**Scope:** Guest verifies via OTP, consents to face scan, and discovers matched photos from a share album.

### Schema changes (`src/lib/schema.ts`)
Add to `Photo`:
```typescript
faceProcessed: integer('faceProcessed', { mode: 'boolean' }).notNull().default(false),
```

New table:
```typescript
export const guests = sqliteTable('Guest', {
  id: text('id').primaryKey(),
  albumId: text('albumId').notNull().references(() => albums.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  faceDescriptor: text('faceDescriptor'),
  sessionToken: text('sessionToken'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});
```

New table:
```typescript
export const photoFaces = sqliteTable('PhotoFace', {
  id: text('id').primaryKey(),
  photoId: text('photoId').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  descriptor: text('descriptor').notNull(),
  boundingBox: text('boundingBox').notNull(),
});
```

OTP storage table:
```typescript
export const guestOtps = sqliteTable('GuestOtp', {
  id: text('id').primaryKey(),
  albumId: text('albumId').notNull().references(() => albums.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  codeHash: text('codeHash').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  consumedAt: integer('consumedAt', { mode: 'timestamp_ms' }),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
});
```

After schema edits run:
`npm run db:generate && npm run db:push`

### API routes
- `POST /api/guest/request-otp` — send 6-digit OTP via Resend and persist hashed OTP.
- `POST /api/guest/verify-otp` — validate OTP, create guest session, set signed guest cookie for 24h.
- `POST /api/guest/enroll-face` — accept 128-float descriptor from browser and store on guest.
- `GET /api/guest/my-photos` — Euclidean-distance match against `photoFaces` in same album, threshold `< 0.5`.

### Background extraction
New script: `scripts/process-faces.ts`
- Reads `Photo.faceProcessed = false`.
- Uses `face-api.js + canvas` in Node.
- Writes `PhotoFace` rows and sets `faceProcessed = true`.
- Runs manually (`npm run faces:process`) or via PM2 cron.
- Never runs in upload request lifecycle.

### Guest page
New page: `src/app/share/[token]/guest/page.tsx`
- OTP request/verify UI.
- Consent screen before camera scan.
- Skippable fallback: "Browse all photos instead".
- Browser face scan via `face-api.js`.
- Display matched photos grid.
- ZIP download via existing `/api/share/[token]/download` route.

### Model files
- Keep models in `public/models/`:
  - `ssd_mobilenetv1`
  - `face_landmark_68`
  - `face_recognition`
- Do not bundle model files via webpack.

### Data handling
- Store descriptor as:
  `JSON.stringify(Array.from(descriptor))`
- Read descriptor as:
  `Float32Array.from(JSON.parse(descriptorJson))`
- All DB access through `src/lib/db.ts`.

### Acceptance criteria
- [x] `guests`, `photoFaces`, and `guestOtps` tables exist; `photos.faceProcessed` exists with default `false`
- [x] `POST /api/guest/request-otp` sends OTP and stores only hashed OTP
- [x] `POST /api/guest/verify-otp` validates OTP and sets signed `guest_session` cookie (24h TTL)
- [x] `POST /api/guest/enroll-face` stores 128-float descriptor JSON on guest record
- [x] `scripts/process-faces.ts` extracts faces and writes descriptors + bounding boxes
- [x] Background face extraction is non-blocking and not part of upload requests
- [x] `GET /api/guest/my-photos` returns photo IDs by Euclidean distance threshold `0.5`
- [x] Guest page supports OTP → consent → scan → matched grid flow
- [x] Consent screen explicitly allows skip with "Browse all photos instead"
- [x] Guest can download matched photos as ZIP through existing download route
- [x] Models are loaded from `public/models/` and not bundled
- [x] `npm run db:generate && npm run db:push` succeeds
- [x] `npx tsc --noEmit` passes with zero errors


## Task: Browser-side face descriptor extraction (Phase 1 of face architecture refactor)

**Status:** Completed
**Scope:** Move face detection inference from the phone server to the photographer's
laptop browser. The phone stores and matches descriptors only — no neural network
inference ever runs on the Android device.

### Architecture
- face-api.js runs in the album manager browser page (photographer's laptop)
- A background React worker processes unprocessed photos silently after page load
- Descriptors (128 floats per face) are POSTed to a new API endpoint on the phone
- The phone stores them in the existing PhotoFace table and marks faceProcessed=true
- Guest matching (Euclidean distance) remains server-side — pure arithmetic, no TF

### New files
- `src/app/albums/[albumId]/FaceProcessor.tsx` — Client Component, background worker
  - Loads face-api.js models from /public/models/ once
  - Processes unprocessed photos one at a time using fetch + canvas in browser
  - Shows dismissible progress indicator: "Processing faces (47/200)"
  - POSTs descriptors to /api/photos/[photoId]/faces on completion of each photo
  - Skips photos that already have faceProcessed=true

### New API route
- `POST /api/photos/[photoId]/faces`
  - Auth: requires valid photographer session (JWT cookie)
  - Body: `{ faces: Array<{ descriptor: number[], boundingBox: { x, y, width, height } }> }`
  - Deletes existing PhotoFace rows for this photoId (idempotent)
  - Inserts new PhotoFace rows
  - Sets photo.faceProcessed = true
  - Returns: `{ saved: number }`

### Modified files
- `src/app/albums/[albumId]/page.tsx`
  - Import and render <FaceProcessor> passing photos with faceProcessed=false
  - Pass API-resolved photo URLs so FaceProcessor can fetch browser-accessible image data

### Existing files — DO NOT touch yet (cleanup phase comes after validation)
- `scripts/process-faces.ts` — keep, disable via PM2 only
- `scripts/process-faces-safe.sh` — keep
- `@napi-rs/canvas` — keep in package.json for now

### Validation criteria before cleanup
- [x] FaceProcessor loads models successfully in browser (check console, no 404s)
- [x] At least 10 photos process successfully end-to-end in browser
- [x] PhotoFace rows appear in DB after browser processing
- [x] faceProcessed = true set correctly on processed photos
- [x] Guest match route returns correct photos using browser-generated descriptors
- [x] Processing does not block album page UI (runs in background)
- [x] Progress indicator shows and is dismissible

### Critical implementation note (do not regress)
- Browser `face-api.js` does **not** accept `ImageBitmap` directly as net input.
- Required flow in `FaceProcessor`:
  - fetch photo URL -> blob -> `createImageBitmap(blob)`
  - draw bitmap onto `HTMLCanvasElement`
  - call `detectAllFaces(canvas, ...)`
- If this is violated, runtime error appears:
  - `toNetInput - expected media to be of type HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | tf.Tensor3D`

### Cleanup phase (completed)
- [x] Archived `scripts/process-faces.ts` → `scripts/archive/process-faces.ts`
- [x] Archived `scripts/process-faces-safe.sh` → `scripts/archive/process-faces-safe.sh`
- [x] Removed PM2 cron job `fotohaven-faces` (not present in final ecosystem.config.js)
- [x] Uninstalled `@napi-rs/canvas`, `@tensorflow/tfjs`, `@tensorflow/tfjs-backend-wasm`, `canvas`
- [x] `face-api.js` retained — still required for browser-side `FaceProcessor.tsx`
- [x] Updated CLAUDE.md and README.md
- [x] Archive README added at `scripts/archive/README.md`

### Acceptance criteria
- [x] Photographer opens album page on any laptop/desktop browser
- [x] All unprocessed photos get descriptors extracted automatically in background
- [x] Phone CPU never runs neural network inference
- [x] Guest face matching works correctly using browser-generated descriptors
- [x] npx tsc --noEmit passes with zero errors

---

## Task: Improve face matching accuracy & performance

**Status:** Completed  
**Scope:** Four targeted improvements to the guest face matching pipeline. No schema changes, no new packages.

### Problem analysis
- Guest enrollment captured a single selfie frame — fragile against angle/lighting variation
- Match threshold `0.5` was too permissive for large crowds (Indian weddings)
- API returned bare `photoIds` with no confidence indication
- Match query used 3 sequential DB queries instead of a join

### Changes

#### Change 1 — Multi-sample guest enrollment
- `src/app/share/[token]/guest/page.tsx` — `scanAndMatch()` now captures **3 frames** at 500ms intervals, extracts a descriptor from each, and averages them before enrolling
- `src/lib/face-math.ts` — Added `averageDescriptors(Float32Array[])` helper
- Requires at least 2 of 3 successful detections; shows per-sample status text
- Status text shows "Capturing sample 1 of 3 — hold still..."

#### Change 2 — Finalize distance metric and threshold
- `src/app/api/guest/my-photos/route.ts` now uses Euclidean distance with `DISTANCE_THRESHOLD = 0.5`
- `face-api.js` descriptors are conventionally compared with Euclidean distance, not cosine distance
- The previous cosine matcher was too permissive and produced huge false-positive result sets

#### Change 3 — Return scored results
- `GET /api/guest/my-photos` now returns `{ photos: [{ photoId, score }] }` sorted best-first (lowest distance = strongest match)
- Guest page shows confidence badges: green "Strong match" (score < 0.42) or amber "Possible match" (score 0.42–0.5)
- Results are sorted best-first so most confident matches appear at top of grid

#### Change 4 — Single-join DB query
- Replaced 3 sequential queries (ceremonies → photos → photoFaces) with a single `innerJoin` query: `photoFaces → photos → ceremonies WHERE albumId = X AND isReturn = false`
- Eliminates `inArray(ceremonyIds)` and `inArray(photoIds)` intermediate arrays

### Modified files
| File | Change |
|------|--------|
| `src/lib/face-math.ts` | Added `averageDescriptors()` helper |
| `src/app/api/guest/my-photos/route.ts` | Euclidean distance matcher, threshold `0.5`, single join query, scored response |
| `src/app/share/[token]/guest/page.tsx` | Multi-frame capture, MatchedPhoto type, confidence badges |

### Files NOT touched
- `src/lib/schema.ts` — no schema changes
- `src/lib/storage.ts` — no file I/O
- `src/lib/db.ts` — no changes
- `src/app/api/guest/enroll-face/route.ts` — receives same `number[]` descriptor format
- `src/app/albums/[albumId]/FaceProcessor.tsx` — photo indexing unchanged

### Acceptance criteria
- [x] Guest enrollment captures 3 frames and averages descriptors (requires ≥2 successful detections)
- [x] Guest matching uses Euclidean distance with threshold `0.5`
- [x] `GET /api/guest/my-photos` returns `{ photos: [{ photoId, score }] }` sorted best-first
- [x] Match results show green "Strong match" (< 0.42) or amber "Possible match" (0.42–0.5) badges
- [x] DB query uses a single join instead of 3 sequential queries
- [x] `averageDescriptors()` correctly averages N Float32Array descriptors
- [x] `npx tsc --noEmit` passes with zero errors

---

## Task: Advanced Album Management (Duplicates, Blur, Compression, Lightbox)

**Status:** Completed
**Scope:** Provide album managers tools in the album view to: visually detect duplicates via perceptual hashing (dHash), blur selected photos (admin-only), control upload compression format and quality, and view photos in a full lightbox with progressive loading.

### Design decisions (confirmed by user)
1. **dHash threshold** — configurable per-album setting (default: 10, range 1–20)
2. **Compression format** — user selects between JPEG and WebP. WebP is preferred for future scalability (smaller at same quality, native browser support); JPEG kept for compatibility. Both use the Canvas API.
3. **Blur on share page** — NOT applied. Blur is an admin-only visual tool. Share page shows all photos normally.

### Schema changes (`src/lib/schema.ts`)
Add to `albums` table:
```typescript
compressionQuality:  integer('compressionQuality').notNull().default(80),   // 1–100
compressionFormat:   text('compressionFormat').notNull().default('webp'),   // 'jpeg' | 'webp'
dedupThreshold:      integer('dedupThreshold').notNull().default(10),       // dHash Hamming distance 1–20
```
Add to `photos` table:
```typescript
isBlurred:   integer('isBlurred', { mode: 'boolean' }).notNull().default(false),
imageHash:   text('imageHash'),   // 64-bit dHash as 16-char hex, computed client-side
```
*(After schema edit, must run: `npm run db:generate && npm run db:push`)*

### New API routes

#### `PATCH /api/albums/[albumId]` — `src/app/api/albums/[albumId]/route.ts`
- Add a `PATCH` handler to the existing file (has `GET` and `DELETE`).
- Accepts `{ compressionQuality?, compressionFormat?, dedupThreshold? }` in body.
- Updates only the provided fields on the album row.
- Returns `200 { ok: true }`.
- Auth: guarded by middleware.

#### `POST /api/photos/blur-batch` — `src/app/api/photos/blur-batch/route.ts`
- Body: `{ photoIds: string[], isBlurred: boolean }`.
- Bulk-updates `photos.isBlurred` for all matching IDs in a single query.
- Returns `200 { ok: true, updatedCount: N }`.

#### Extend `PATCH /api/photos/[photoId]` — `src/app/api/photos/[photoId]/route.ts`
- Existing handler accepts `{ isSelected }`. Extend to also accept `{ imageHash }`.
- When `imageHash` is provided in the body, update `photos.imageHash` for that photo.
- This lets the browser persist computed perceptual hashes after scanning.

### UI changes (`src/app/albums/[albumId]/page.tsx`)

#### A. Upload Settings Panel (Compression)
- Below the drag-and-drop zone, add a collapsible "⚙ Upload Settings" section.
- Contains:
  - **Format selector**: radio/toggle between `JPEG` and `WebP` (default WebP).
  - **Quality slider**: 10–100 (default 80), labelled "Quality: N%".
  - "Save as album default" button → calls `PATCH /api/albums/[albumId]`.
- In `onDrop`: before queueing each file, run client-side compression:
  ```
  canvas.drawImage(img) → canvas.toBlob(blob, 'image/webp', quality/100)
  ```
  The compressed blob replaces the original file in the upload queue; filename is preserved with the correct extension.

#### B. Perceptual Duplicate Detection
- Add a "🔍 Find Duplicates" button in the ceremony header area.
- On click, for each photo in the active ceremony:
  1. Load `photo.url` (thumbnail) into an `<img>` element.
  2. Draw to an offscreen 9×8 Canvas in grayscale.
  3. Compute dHash: compare each adjacent pixel pair across rows → 64-bit integer → 16-char hex.
  4. If `photo.imageHash` is already stored (from DB), use it; skip re-computation.
  5. If newly computed, persist via `PATCH /api/photos/:id` with `{ imageHash }`.
- Group photos whose hashes are within Hamming distance ≤ `album.dedupThreshold`.
- Show a results modal listing each duplicate group with thumbnails.
- "Select All Duplicates" button: for each group, keeps the oldest photo (by `createdAt`) and adds the rest to `selectedPhotos`.
- `dedupThreshold` is shown as a configurable slider (1–20) in the same panel; changes auto-filter results.

#### C. Blur Toggle
- In the floating selection action bar (shown when ≥1 photo selected), add:
  - "🔒 Blur Selected" button → calls `POST /api/photos/blur-batch` with `{ photoIds, isBlurred: true }`.
  - "🔓 Unblur Selected" button → same with `isBlurred: false`.
- After API call, update local album state to reflect new `isBlurred` value.
- `PhotoCard` applies `filter: blur(12px) saturate(0)` on the `<img>` when `isBlurred` is true.
- A small 🔒 badge appears top-left on blurred PhotoCards (alongside or replacing the checkbox when not in selection mode).
- Add `isBlurred` to the local `Photo` interface.

#### D. Lightbox Viewer (NEW — currently missing on album page)
- Clicking the photo image area (not the checkbox, not delete) opens a full-screen lightbox.
- Lightbox shows:
  - Full-resolution image with progressive loading: render `photo.url` (thumbnail) blurred as placeholder, overlay the `originalUrl` (full-res) which fades in when loaded.
  - Left / right navigation arrows.
  - Keyboard: ArrowLeft, ArrowRight, Escape.
  - Close button (top-right ×).
  - Photo name and index counter (e.g. "3 / 47").
  - "Select" toggle button in the lightbox so photographer can select/deselect without closing.

### UI changes (`src/app/share/[token]/page.tsx`)
- **Blur: NO changes.** Share page renders photos normally regardless of `isBlurred`. Blur is admin-only.
- **Progressive lightbox loading**: Apply the same progressive-load technique to the existing share page lightbox:
  - Show `photo.url` (thumbnail) as a blurred background placeholder immediately.
  - Overlay a second `<img>` loading `photo.originalUrl`; fade it in on `onLoad`.
  - This eliminates the blank/slow wait when opening large originals.

### Files NOT touched
- `src/lib/storage.ts` — no file I/O
- `src/lib/db.ts` — no changes
- `src/middleware.ts` — no changes (new routes fall under already-guarded `/api/photos/*` and `/api/albums/*`)

### Acceptance criteria
- [x] Schema updated: `albums` gets `compressionQuality`, `compressionFormat`, `dedupThreshold`; `photos` gets `isBlurred`, `imageHash`.
- [x] `PATCH /api/albums/[albumId]` persists compression + dedup settings.
- [x] `POST /api/photos/blur-batch` bulk-toggles `isBlurred` in DB.
- [x] `PATCH /api/photos/[photoId]` accepts and persists `imageHash`.
- [x] dHash algorithm computes a stable 16-char hex fingerprint for any image.
- [ ] "Find Duplicates" groups photos by Hamming distance ≤ configurable threshold (default 10).
- [ ] Duplicate threshold slider (1–20) filters results live; default saved to album.
- [x] Compression Format selector (JPEG / WebP) and Quality slider work before upload.
- [x] "Save as album default" persists compression settings to DB.
- [ ] Blurred photos show `blur(12px) saturate(0)` + 🔒 badge in album manager.
- [ ] Share page is NOT affected by `isBlurred` — photos render normally.
- [ ] Album manager has a working lightbox with progressive thumbnail→full-res loading.
- [ ] Share page lightbox uses progressive loading (thumbnail placeholder → full-res fade).
- [x] `npx tsc --noEmit` passes with zero errors.

---

## Task: Parallel Browser Compression Controls

**Status:** Completed
**Scope:** Speed up upload preparation on the photographer's browser by allowing bounded parallel image compression, expose a configurable concurrency control in the album upload settings, and add console timing logs for each prepared file.

### Schema change
None.

### Modified files

#### `src/app/albums/[albumId]/page.tsx`
- Add a local `compressionConcurrency` setting for browser-side preparation.
- Update `onDrop` to prepare files with bounded parallelism while preserving queue order.
- Add console logs for compression start/end, original size, output size, and elapsed milliseconds.
- Add a small UI control in Upload Settings to choose concurrency (recommended default: `2`).
- Make it explicit in the UI that concurrency is a browser-only setting and is not saved as an album default.

#### `src/lib/image-utils.ts`
- No algorithm rewrite required.
- Continue using `compressImageFile()` as the single-file primitive while allowing the album page to orchestrate parallel execution.

### Implementation plan
1. Keep compression browser-side; do not move work onto the Android server.
2. Introduce bounded parallel processing with a small configurable cap.
3. Preserve upload queue ordering so prepared files still appear in the same order as selected files.
4. Add concise console logs to help diagnose slow or failed preparation runs from the browser.
5. Verify with `npx tsc --noEmit`.

### Acceptance criteria
- [x] Upload preparation can run with configurable parallel compression in the browser.
- [x] Default concurrency is a safe low number (`2`).
- [x] Prepared files preserve the same order as the selected input files.
- [x] Browser console logs show per-file compression timing and size information.
- [x] The setting works with `original`, `jpeg`, and `webp` modes.
- [x] No schema changes are introduced.
- [x] `npx tsc --noEmit` passes with zero errors.

---

## Task: Face Reprocessing Reset

**Status:** Completed
**Scope:** Give the photographer a one-click way to clear stale face descriptors for an album and trigger browser-side reprocessing using the latest matching pipeline.

### Schema change
None.

### New API route
- `POST /api/albums/[albumId]/reprocess-faces` — `src/app/api/albums/[albumId]/reprocess-faces/route.ts`
  - Auth: guarded by middleware under `/api/albums/*`
  - Finds all original photos in the album
  - Deletes their `PhotoFace` rows
  - Sets `Photo.faceProcessed = false`
  - Returns `{ resetCount }`

### UI changes
- `src/app/albums/[albumId]/page.tsx`
  - Add a `Reprocess Faces` button in the ceremony action row
  - Confirm before clearing descriptors
  - Refresh album data after reset so `FaceProcessor` automatically resumes

### Documentation changes
- `CLAUDE.md`
  - Document the new reset route and the tighter face-match threshold
  - Clarify that album reprocessing is required after major descriptor-pipeline improvements
- `README.md`
  - Document the reprocess flow for operators using guest face discovery

### Acceptance criteria
- [x] Photographer can reset face processing for an album from the album manager
- [x] Reset deletes old `PhotoFace` rows and marks album photos `faceProcessed = false`
- [x] Browser-side `FaceProcessor` resumes automatically after refresh
- [x] No schema changes are introduced
- [x] `npx tsc --noEmit` passes with zero errors


