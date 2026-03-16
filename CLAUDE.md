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

The app runs on a **Next.js 14 App Router** server. The primary deployment target
is an **old Android phone running Termux + PM2 + Cloudflare Tunnel** — not Vercel.
Always keep ARM compatibility and low memory footprint in mind.

---

## Tech stack — exact versions

| Package | Version | Purpose |
|---------|---------|---------|
| next | 14.1.4 | Framework (App Router) |
| react / react-dom | 18.2.x | UI |
| @prisma/client | 5.11.x | ORM |
| prisma | 5.11.x | CLI + migrations |
| @aws-sdk/client-s3 | 3.540.x | Cloudflare R2 (S3-compatible) |
| @aws-sdk/s3-request-presigner | 3.540.x | Presigned URLs |
| react-dropzone | 14.2.x | File drag-and-drop |
| jszip | 3.10.x | Client-side ZIP generation |
| lucide-react | 0.368.x | Icons |
| uuid | 9.0.x | ID generation |
| tailwindcss | 3.4.x | Utility CSS (used sparingly) |

**Do not upgrade major versions without explicit instruction.**

---

## Repository layout

```
fotohaven/
├── prisma/
│   └── schema.prisma          ← SINGLE SOURCE OF TRUTH for all data models
├── src/
│   ├── app/                   ← Next.js App Router (all routes live here)
│   │   ├── layout.tsx         ← Root layout, Google Fonts loaded here
│   │   ├── globals.css        ← Design system: CSS vars, utility classes
│   │   ├── page.tsx           ← / → Client dashboard (album list)
│   │   ├── albums/
│   │   │   ├── new/page.tsx   ← /albums/new → 3-step album creation form
│   │   │   └── [albumId]/
│   │   │       └── page.tsx   ← /albums/:id → Album manager + uploader
│   │   ├── share/
│   │   │   └── [token]/
│   │   │       └── page.tsx   ← /share/:token → Photographer gallery view
│   │   └── api/
│   │       ├── albums/
│   │       │   ├── route.ts          ← GET /api/albums, POST /api/albums
│   │       │   └── [albumId]/
│   │       │       └── route.ts      ← GET /api/albums/:id
│   │       ├── upload/
│   │       │   └── route.ts          ← POST /api/upload (presigned URL)
│   │       └── share/
│   │           └── [token]/
│   │               └── route.ts      ← GET /api/share/:token
│   ├── lib/
│   │   ├── db.ts              ← Prisma client singleton (never instantiate elsewhere)
│   │   └── storage.ts         ← ALL storage I/O goes through here (R2 or local)
│   └── types/
│       └── index.ts           ← Shared TypeScript interfaces
├── infra/
│   └── android/
│       ├── termux-setup.sh         ← One-shot phone bootstrap
│       ├── cloudflared-config.yml  ← Cloudflare Tunnel config
│       ├── health-check.sh         ← Server health monitoring
│       ├── backup.sh               ← DB + photo backup
│       └── local-storage-adapter.ts ← Drop-in replacement for storage.ts
├── ecosystem.config.js        ← PM2 process manager config
├── .env.example               ← All env vars documented
└── CLAUDE.md                  ← This file
```

---

## Data models (Prisma)

```
Album
  id           String    @id uuid
  title        String
  clientName   String    (photographer's name / studio)
  shareToken   String    @unique (16-char hex, URL-safe)
  password     String?   (bcrypt hash — not yet enforced in UI)
  expiresAt    DateTime?
  createdAt    DateTime
  updatedAt    DateTime
  ceremonies   Ceremony[]

Ceremony
  id        String   @id uuid
  name      String   (e.g. "Mehndi", "Wedding")
  albumId   String   → Album (cascade delete)
  order     Int      (display order)
  createdAt DateTime
  photos    Photo[]

Photo
  id           String   @id uuid
  filename     String   (sanitised: {photoId}.{ext})
  originalName String   (user's original filename)
  size         Int      (bytes)
  mimeType     String
  storageKey   String   (R2/S3 object key — never expose raw)
  width        Int?
  height       Int?
  ceremonyId   String   → Ceremony (cascade delete)
  createdAt    DateTime
```

**Cascade rule:** Deleting an Album deletes all its Ceremonies.
Deleting a Ceremony deletes all its Photos.
Always delete storage objects before DB records to avoid orphaned files.

---

## Environment variables

All required vars — never hardcode values, always read from env:

```env
# Database
DATABASE_URL="file:./prisma/dev.db"          # SQLite (dev + Android)
# DATABASE_URL="postgresql://..."            # Postgres (Vercel prod)

# Cloudflare R2 (S3-compatible storage)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=fotohaven
R2_PUBLIC_URL=                               # https://pub-xxxx.r2.dev

# App
NEXT_PUBLIC_APP_URL=                         # full URL incl https://
APP_SECRET=                                  # 32-byte hex, used for tokens

# Android local storage mode (optional — swaps out R2)
LOCAL_UPLOAD_PATH=                           # /path/to/uploads/dir
```

---

## API contracts

### POST /api/albums
**Request:**
```json
{
  "title": "string",
  "clientName": "string",
  "ceremonies": ["string"],
  "expiresAt": "ISO date string | null"
}
```
**Response 201:** Full Album object with nested Ceremonies (no Photos yet).

### GET /api/albums
**Response 200:** Array of Albums, each with `ceremonies[].{id, name, _count.photos}` and `totalPhotos`.

### GET /api/albums/:albumId
**Response 200:** Full Album with `ceremonies[].photos[]`, each photo having a `url` field (presigned, 1hr TTL).
**Response 404:** `{ error: "Album not found" }`

### POST /api/upload
**Request:**
```json
{
  "ceremonyId": "uuid",
  "filename": "string",
  "contentType": "image/jpeg | image/png | image/webp | image/heic | image/heif",
  "size": "number (bytes, max 52428800)"
}
```
**Response 201:**
```json
{
  "photoId": "uuid",
  "uploadUrl": "presigned PUT URL (15min TTL)",
  "storageKey": "albums/{albumId}/ceremonies/{ceremonyId}/{photoId}/{filename}"
}
```
Client PUTs the raw file body directly to `uploadUrl`. No multipart, no base64.

### GET /api/share/:token
**Response 200:** Album (password field stripped) with ceremonies + photos + presigned URLs (2hr TTL).
**Response 404:** `{ error: "Album not found" }`
**Response 410:** `{ error: "This link has expired" }` — when `expiresAt` is in the past.

---

## Storage abstraction

**All file I/O must go through `src/lib/storage.ts`.** Never import AWS SDK directly in routes or components.

Exported functions:
```typescript
uploadFile(key, buffer, contentType): Promise<string>
getPresignedUrl(key, expiresIn?): Promise<string>       // default 3600s
getPresignedUploadUrl(key, contentType, expiresIn?): Promise<string>  // default 900s
deleteFile(key): Promise<void>
getPublicUrl(key): string
buildPhotoKey(albumId, ceremonyId, photoId, filename): string
  // returns: albums/{albumId}/ceremonies/{ceremonyId}/{photoId}/{filename}
```

For Android local-storage mode, `infra/android/local-storage-adapter.ts` is a
drop-in replacement with identical exports. Copy it over `src/lib/storage.ts` when
deploying on-device.

---

## Design system

Defined in `src/app/globals.css`. **Do not use Tailwind for colours or spacing —
use CSS variables.** Tailwind is only used for responsive grid utilities.

### Colour palette
```
--cream:       #faf7f2   (page background)
--warm-white:  #f5f0e8   (card backgrounds, input fills)
--sand:        #e8ddd0   (borders, dividers)
--taupe:       #c9b99a   (muted text, placeholders)
--brown:       #8b6f47   (secondary text)
--espresso:    #3d2b1f   (primary text, headings)
--ink:         #1a1208   (darkest text)
--gold:        #c9963a   (primary accent, CTAs)
--gold-light:  #e8c068   (hover states)
--sage:        #7a8c6e   (success states)
--blush:       #d4856a   (error states)
```

### Typography
- Display/headings: `Cormorant Garamond` (loaded via Google Fonts in layout.tsx)
- Body/UI: `DM Sans`
- CSS vars: `--font-display`, `--font-body`

### Pre-built utility classes (use these, don't reinvent)
- `.card` — white card with border + shadow
- `.btn-primary` — dark espresso button
- `.btn-ghost` — outlined ghost button
- `.btn-gold` — gold accent button
- `.tag` — small pill badge
- `.input` — styled text input
- `.photo-grid` — responsive photo masonry grid
- `.skeleton` — shimmer loading placeholder
- `.animate-fade-up` — entrance animation

---

## Coding conventions

### File structure
- All new API routes: `src/app/api/{resource}/route.ts`
- All new pages: `src/app/{path}/page.tsx` with `"use client"` at top if interactive
- New shared utilities: `src/lib/{name}.ts`
- New types: add to `src/types/index.ts`

### TypeScript
- Strict mode is on. No `any` types.
- All API route handlers must be typed with `NextRequest` and `NextResponse`.
- Shared interfaces live in `src/types/index.ts` — import from there, don't redeclare.

### API routes
- Always return `NextResponse.json({ error: "..." }, { status: N })` for errors.
- Log errors with `console.error("[ROUTE_NAME]", err)` before returning 500.
- Validate all required fields before hitting the DB.

### Database
- Import `db` from `@/lib/db` — never `new PrismaClient()`.
- Use `include` for relations, never raw SQL.
- All DB writes wrap in try/catch with proper cleanup (e.g. delete storage on DB failure).

### Components
- All interactive components (useState, useEffect, handlers): `"use client"` at top.
- Server components (no interactivity, just data display): no directive needed.
- No CSS-in-JS. Styles go in globals.css or inline `style={{}}` using CSS vars.

### Do not
- Do not add new npm packages without asking.
- Do not change the Prisma schema without also writing the migration.
- Do not hardcode colours — use CSS variables.
- Do not expose `storageKey`, `password`, or internal IDs in public API responses.
- Do not use `fetch` in server components — use `db` directly.
- Do not add authentication middleware yet (out of scope for MVP).

---

## Current MVP scope (what's built)

- [x] Album creation (3-step form: title/name → ceremonies → settings)
- [x] Photo upload per ceremony via presigned PUT to R2
- [x] Album management page (drag-drop zone, upload queue, photo grid)
- [x] Share link generation (token-based, optional expiry)
- [x] Photographer gallery view (browse by ceremony, lightbox, select)
- [x] Bulk ZIP download (per-ceremony or all, client-side JSZip)

## Roadmap (not yet built — implement when asked)

- [ ] Per-photo comments (Photographer annotates photos)
- [ ] Upload-back flow (Photographer delivers edited finals)
- [ ] Password-protected share links (bcrypt enforcement)
- [ ] Email notifications (Resend)
- [ ] WhatsApp notifications (Twilio/WATI)
- [ ] AI duplicate/blur detection before upload
- [ ] Watermarked preview mode
- [ ] Health dashboard UI (phone stats, tunnel status)
- [ ] Print ordering (Canvera/Zoomin India)

---

## Android hosting context

The production environment is an Android phone running:
- **Termux** (Linux userspace, ARM64)
- **Node.js** via Termux's `pkg install nodejs`
- **PM2** for process management (`ecosystem.config.js` at repo root)
- **Cloudflare Tunnel** (`infra/android/cloudflared-config.yml`)
- **SQLite** for the database (single file, zero config)

**Memory budget:** Keep Next.js production build under 300 MB RSS.
Avoid packages that spawn child processes or require native compilation (some npm
packages with `.node` bindings don't compile on ARM — test before adding).

**Build command on phone:** `npm run build`
**Start command:** `pm2 start ecosystem.config.js`
**Health check:** `bash infra/android/health-check.sh`
**Backup:** `bash infra/android/backup.sh`

---

## How to run locally (dev)

```bash
npm install
cp .env.example .env.local   # fill in R2 credentials
npm run db:generate
npm run db:push
npm run dev                   # → http://localhost:3000
```

## How to run on Android phone (prod)

See `infra/android/termux-setup.sh` — it is fully automated and idempotent.
See `README.md` for the full step-by-step guide.
