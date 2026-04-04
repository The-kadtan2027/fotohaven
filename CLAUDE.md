# CLAUDE.md — FotoHaven Agent Context

> This file is read automatically by Claude Code at the start of every session.
> It tells the agent everything about this project: what it is, how it's built,
> what conventions to follow, and what to never break.

---

## What this project is

**FotoHaven** is a photo handoff platform for event photographers and clients.
The primary use case is Indian weddings: a client selects photos from a multi-ceremony
event (Mehndi, Sangeet, Wedding, Reception) and hands them off to a photographer
via a secure share link — no WhatsApp, no Google Drive.

The app runs on a **Next.js 15 App Router** server. The primary deployment target
is an **old Android phone running Termux + PM2 + Cloudflare Tunnel (or Tailscale Funnel)**.
Always keep ARM compatibility and low memory footprint in mind.

## Tech stack — exact versions

| Package | Version | Purpose |
|---------|---------|---------|
| next | 15.1.4 | Framework (App Router) |
| react / react-dom | 19.x | UI |
| drizzle-orm | ^0.45.1 | ORM (Database access) |
| better-sqlite3 | ^12.8.0 | SQLite Driver (Native Termux compatibility) |
| resend | ^6.9.3 | Email notifications |
| bcryptjs | ^3.0.3 | Password hashing |
| archiver | ^7.0.1 | Server-side ZIP Streaming |
| jose | ^6.x | JWT (Edge-compatible, used in middleware) |
| @aws-sdk/client-s3 | 3.540.x | Cloudflare R2 / Local Storage |
| lucide-react | 0.468.x | Icons |
| uuid | 9.0.x | ID generation |

---

## Repository layout

```
fotohaven/
├── src/
│   ├── lib/
│   │   ├── schema.ts          ← SINGLE SOURCE OF TRUTH (Drizzle tables)
│   │   ├── db.ts              ← Drizzle client (better-sqlite3)
│   │   ├── storage.ts         ← Storage abstraction (R2 or local)
│   │   └── email.ts           ← Email utility (Resend)
│   ├── app/                   ← Next.js App Router
│   │   ├── api/
│   │   │   ├── albums/        ← CRUD for albums + download
│   │   │   ├── share/         ← Public gallery data (password guarded, upload-returns, download)
│   │   │   ├── upload/        ← S3/Local upload handler
│   │   │   ├── photos/        ← Photo DELETE (auth), PATCH isSelected (public), batch-delete
│   │   │   ├── ceremonies/    ← Add/Delete ceremony folders
│   │   │   ├── auth/          ← login, logout, me (JWT cookie)
│   │   │   ├── comments/      ← Per-photo comments (POST/GET)
│   │   │   └── files/         ← Local file serving (Range request support)
│   │   ├── share/[token]/     ← Public gallery UI (challenge screen)
│   │   └── albums/[id]/       ← Admin manage view
│   └── types/                 ← Shared TS interfaces
├── drizzle/                   ← Generated SQL migrations
├── drizzle.config.js          ← Drizzle-kit configuration
├── .env                       ← Secret keys (local)
└── CLAUDE.md                  ← This file
```

---

## Data models (Drizzle: src/lib/schema.ts)

### Album
- `id`: UUID string
- `title`: String
- `clientName`: Photographer/Studio name
- `shareToken`: 16-char URL-safe token
- `password`: Bcrypt hash (optional)
- `notifyEmail`: Email to alert on first view (optional)
- `compressionQuality`: Integer 10-100, default 80
- `compressionFormat`: `"jpeg" | "webp"`, default `"webp"`
- `dedupThreshold`: Integer 1-20, default 10
- `firstViewedAt`: Timestamp of first client access
- `expiresAt`: Link expiry timestamp
- `createdAt` / `updatedAt`: Timestamps

### Ceremony
- `id`: UUID string
- `name`: e.g. "Haldi", "Wedding"
- `albumId`: Foreign key to Album (Cascade)
- `order`: Integer for sorting

### Photo
- `id`: UUID string
- `originalName`: User's filename
- `storageKey`: Path in R2/Local storage
- `thumbnailKey`: Path to 800px downscaled JPEG (optional)
- `ceremonyId`: Foreign key to Ceremony (Cascade)
- `isReturn`: Boolean — true = edited final delivered by photographer
- `returnOf`: Optional photoId linking to original (nullable)
- `isSelected`: Boolean (default false) — client-marked selection, persistent across sessions
- `isBlurred`: Boolean (default false) — admin-side visual blur only
- `imageHash`: Optional 16-char perceptual dHash fingerprint
- `comments`: Relation to Comment table

### Comment
- `id`: UUID string
- `body`: Text content
- `author`: "photographer" | "client"
- `photoId`: Foreign key to Photo (Cascade)

### Photographer
- `id`: UUID string
- `username`: Unique username (for admin login)
- `passwordHash`: bcrypt hash
- `createdAt`: Timestamp
- Seed with `npm run seed` using `ADMIN_USERNAME` + `ADMIN_PASSWORD` env vars

---

## API Contracts

### GET /api/share/:token
- **Guard**: Returns `401 { passwordRequired: true }` if album has password and `Authorization: Bearer <pass>` header is missing.
- **Trigger**: Sets `firstViewedAt` and sends Resend notification on first successful load.
- **Response**: Full gallery data including comments and `isSelected` per photo.

### PATCH /api/photos/:photoId
- **Auth**: **Not required** — called from the unauthenticated share page.
- **Body**: `{ isSelected?: boolean, imageHash?: string | null }`
- **Response**: `{ ok: true }` or `404`.
- **Purpose**: Persists client photo selection and browser-computed dHash values.

### PATCH /api/albums/:albumId
- **Auth**: Required (session cookie, guarded by middleware).
- **Body**: `{ compressionQuality?, compressionFormat?, dedupThreshold? }`
- **Response**: `{ ok: true }`
- **Purpose**: Saves per-album upload compression and duplicate-detection defaults.

### POST /api/photos/blur-batch
- **Auth**: Required (session cookie, guarded by middleware).
- **Body**: `{ photoIds: string[], isBlurred: boolean }`
- **Response**: `{ ok: true, updatedCount: number }`
- **Purpose**: Bulk toggles admin-side blur state.

### POST /api/photos/:photoId/faces
- **Auth**: Required (photographer session cookie / JWT).
- **Body**: `{ faces: Array<{ descriptor: number[], boundingBox: { x, y, width, height } }> }`
- **Effect**:
  - Replaces existing `PhotoFace` rows for the photo (idempotent overwrite).
  - Inserts new descriptors and bounding boxes.
  - Sets `Photo.faceProcessed = true`.
- **Purpose**: Stores browser-extracted descriptors; no server-side neural inference.

### POST /api/albums/:albumId/reprocess-faces
- **Auth**: Required (session cookie, guarded by middleware).
- **Effect**: Deletes stored `PhotoFace` rows for the album's original photos and sets `Photo.faceProcessed = false`.
- **Purpose**: Forces browser-side descriptor regeneration after pipeline or threshold improvements.

### GET /api/guest/my-photos
- **Auth**: Requires `guest_session` cookie (JWT, 24h TTL).
- **Response**: `{ photos: [{ photoId: string, score: number }] }` — sorted by ascending Euclidean distance (best matches first).
- **Threshold**: `0.5` Euclidean distance (`face-api.js`-style same-person matching).
- **Score meaning**: `< 0.42` = strong match, `0.42–0.5` = possible match.
- **Enrollment**: Guest page captures 3 selfie frames at 500ms intervals, averages descriptors via `averageDescriptors()` for robustness.

### DELETE /api/photos/:photoId
- **Auth**: Required (session cookie, guarded by middleware).
- **Effect**: Deletes file from storage + DB row.

### POST /api/auth/login
- **Body**: `{ username, password }`
- **Response**: Sets `session` HttpOnly JWT cookie (7-day expiry).

### POST /api/auth/logout
- **Effect**: Clears `session` cookie.

### GET /api/auth/me
- **Response**: `{ id, username }` if JWT valid, else `401`.

### POST /api/comments
- **Body**: `{ photoId, body, author }`
- **Response**: Created comment object.

### GET /api/comments?photoId=uuid
- **Response**: List of comments for the photo.

### Middleware guards (src/middleware.ts)
- **Redirects** unauthenticated browser requests to `/` and `/albums/*` → `/login`.
- **Returns 401** for unauthenticated API calls to `/api/albums`, `/api/upload`, `/api/ceremonies`.
- **`/api/photos` PATCH + GET are public** (client selection from share page). DELETE is guarded.
- **Public**: `/api/auth/*`, `/api/share/*`, `/api/comments/*`, `/api/files/*`, `/login`, `/share/*`.

---

## Commands

### Development
```bash
npm run dev           # Start Next.js dev server
npm run db:generate   # Generate migrations from schema.ts
npm run db:push       # Sync local.db with latest schema; back up production DB first on phone
npm run db:studio     # Open Drizzle GUI for DB browsing
```

### Build & Deploy (on Android/ARM)
```bash
npm run build         # Next.js production build
pm2 start ecosystem.config.js
```

---

## Android hosting context
- **Environment**: Ubuntu 24.04 LTS (Chroot on rooted or PRoot via `ubuntu-proot-setup.sh`) OR Termux + Alpine (musl). Tailscale Funnel or Cloudflare Tunnel for exposure.
- **ORM**: Drizzle + better-sqlite3 (No native Prisma binaries). `db.ts` uses WAL mode and custom timeouts for concurrency.
- **Storage**: `LOCAL_UPLOAD_PATH` for offline/on-device hosting. Supports 206 Partial Content (Range requests).
- **Uploads**: Hard limit of **100MB** per photo. Uses a streaming pipeline to save memory. Thumbnail generation requires `sharp` (Android/ARM needs Wasm fallback: `npm install --cpu=wasm32 sharp @img/sharp-wasm32`).
- **Album manager extras**:
  - Uploads can be client-side compressed to JPEG or WebP before queueing.
  - Duplicate review uses browser-side dHash and persists `Photo.imageHash`.
  - Admin blur is visual-only in `/albums/[albumId]`; share pages ignore `isBlurred`.
  - Album and share lightboxes progressively swap thumbnail → original image.
- **Next.js**: Uses `transpilePackages: ['lucide-react']` and `serverExternalPackages: ['better-sqlite3', 'sharp']` in `next.config.mjs` for build compatibility.
- **Face processing architecture**:
  - **Active path**: Browser-side extraction via `src/app/albums/[albumId]/FaceProcessor.tsx`.
  - Browser loads models from `/public/models` with `loadFromUri('/models')`.
  - Album indexing now uses `detectAllFaces(...).withFaceLandmarks().withFaceDescriptors()` for aligned descriptors rather than raw crop descriptors.
  - Detection input must be canvas/image/video/tensor. `ImageBitmap` must be drawn onto canvas before `detectAllFaces`.
  - Server only stores descriptors and runs Euclidean distance matching; heavy inference is offloaded from Android phone CPU.
  - If matching quality changes materially, use `POST /api/albums/:albumId/reprocess-faces` or the album-page `Reprocess Faces` button so stored descriptors are regenerated.
  - **Archived**: Server-side scripts (`process-faces.ts`, `process-faces-safe.sh`) moved to `scripts/archive/` — kept for reference but not active. Native deps (`@napi-rs/canvas`, `@tensorflow/tfjs`, `canvas`) are uninstalled. `face-api.js` is retained for browser use.

---
