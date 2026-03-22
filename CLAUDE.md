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
│   │   │   ├── albums/        ← CRUD for albums
│   │   │   ├── share/         ← Public gallery data (password guarded)
│   │   │   ├── upload/        ← S3/Local upload handler
│   │   │   └── comments/      ← Per-photo comments (POST/GET)
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
- `comments`: Relation to Comment table

### Comment
- `id`: UUID string
- `body`: Text content
- `author`: "photographer" | "client"
- `photoId`: Foreign key to Photo (Cascade)

---

## API Contracts

### GET /api/share/:token
- **Guard**: Returns `401 { passwordRequired: true }` if album has password and `Authorization: Bearer <pass>` header is missing.
- **Trigger**: Sets `firstViewedAt` and sends Resend notification on first successful load.
- **Response**: Full gallery data including comments.

### POST /api/comments
- **Body**: `{ photoId, body, author }`
- **Response**: Created comment object.

### GET /api/comments?photoId=uuid
- **Response**: List of comments for the photo.

---

## Commands

### Development
```bash
npm run dev           # Start Next.js dev server
npm run db:generate   # Generate migrations from schema.ts
npm run db:push       # Sync local.db with latest schema
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
- **Next.js**: Uses `transpilePackages: ['lucide-react']` and `serverExternalPackages: ['better-sqlite3', 'sharp']` in `next.config.mjs` for build compatibility.

---


