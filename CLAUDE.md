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
| @prisma/client | 5.22.x | ORM |
| prisma | 5.22.x | CLI + migrations |
| @aws-sdk/client-s3 | 3.540.x | Cloudflare R2 (S3-compatible) |
| @aws-sdk/s3-request-presigner | 3.540.x | Presigned URLs |
| react-dropzone | 14.2.x | File drag-and-drop |
| jszip | 3.10.x | Client-side ZIP generation |
| lucide-react | 0.468.x | Icons (React 19 compatible) |
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

## Android / Termux — known fixes

### Prisma engine fix (one-time setup)

Prisma detects Android as unknown OS and defaults to linux,
but downloads the wrong x86_64 Debian engine binary.
The app will crash at runtime with "EM_X86_64 instead of EM_AARCH64".

Fix applied:
1. schema.prisma generator block must have:
     binaryTargets = ["native", "linux-arm64-openssl-3.0.x"]

2. The ARM64 query engine binary must be manually downloaded from:
     https://binaries.prisma.sh/all_commits/{ENGINE_HASH}/linux-arm64-openssl-3.0.x/query-engine.gz
   Engine hash found at: node_modules/@prisma/engines/package.json
   → field: "@prisma/engines-version"

3. Extracted binary placed in both:
     node_modules/@prisma/engines/query-engine-linux-arm64-openssl-3.0.x
     node_modules/.prisma/client/query-engine-linux-arm64-openssl-3.0.x
   Both chmod +x

Note: `infra/android/prisma-android-fix.js` automates steps 3 and 4 as a
postinstall hook. It detects Termux via `TERMUX_VERSION` env var (not
`process.platform` which always reports `linux` on Termux). The engine
version string (`5.22.0-44.{hash}`) is parsed to extract the hash only.

4. The x86_64 library engine deleted from:
     node_modules/.prisma/client/libquery_engine-debian-openssl-1.1.x.so.node
     node_modules/@prisma/engines/libquery_engine-debian-openssl-1.1.x.so.node

5. npx prisma generate run after above steps.

After any npm install, steps 3 and 4 must be repeated as
npm install overwrites node_modules and restores the wrong binary.
To automate: add a postinstall script in package.json.

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


### Termux+Alpine environment — architecture and runtime facts

This Termux installation uses TermuxAlpine (musl libc, aarch64).
Bare Termux has NO GNU linker (`ld-linux-aarch64.so.1`) and NO `libgcc_s.so.1`.
Prisma's `debian-openssl-1.1.x` binaries are x86-64 — never usable on this device.

Key paths:
  Alpine musl linker (inside Alpine):   /lib/ld-musl-aarch64.so.1
  Alpine musl linker (from Termux):     /data/data/com.termux/files/usr/share/TermuxAlpine/lib/ld-musl-aarch64.so.1
  Alpine OpenSSL libs:                  /data/data/com.termux/files/usr/share/TermuxAlpine/usr/lib/
  Enter Alpine:                         startalpine
  Project path inside Alpine:           /data/data/com.termux/files/home/fotohaven

---

### Prisma on Termux+Alpine — definitive setup procedure

Binary target: `linux-musl-arm64-openssl-3.0.x` (only working target on this device)

schema.prisma generator block:
  generator client {
    provider      = "prisma-client-js"
    binaryTargets = ["native", "linux-musl-arm64-openssl-3.0.x"]
  }

After `npm install`, ALL of the following must be redone (npm install overwrites node_modules):

#### Step 1 — Download musl ARM64 engines (from bare Termux)
  ENGINE_HASH is found at: node_modules/@prisma/engines/package.json → "@prisma/engines-version"
  Parse: "5.22.0-44.{hash}" → take only the hash part

  curl -L "https://binaries.prisma.sh/all_commits/{HASH}/linux-musl-arm64-openssl-3.0.x/schema-engine.gz" | gunzip > node_modules/@prisma/engines/schema-engine-linux-musl-arm64-openssl-3.0.x
  curl -L "https://binaries.prisma.sh/all_commits/{HASH}/linux-musl-arm64-openssl-3.0.x/query-engine.gz"  | gunzip > node_modules/@prisma/engines/query-engine-linux-musl-arm64-openssl-3.0.x
  cp node_modules/@prisma/engines/schema-engine-linux-musl-arm64-openssl-3.0.x node_modules/.prisma/client/
  cp node_modules/@prisma/engines/query-engine-linux-musl-arm64-openssl-3.0.x  node_modules/.prisma/client/
  chmod +x node_modules/@prisma/engines/*musl* node_modules/.prisma/client/*musl*

#### Step 2 — Patch binaries (from inside Alpine: startalpine)
  apk add patchelf   # if not already installed

  for each of the 4 binaries (schema-engine + query-engine in both @prisma/engines and .prisma/client):
    patchelf --set-interpreter /lib/ld-musl-aarch64.so.1 <binary>
    patchelf --set-rpath /usr/lib:/lib <binary>

  Verify:
    /data/data/com.termux/files/home/fotohaven/node_modules/.prisma/client/schema-engine-linux-musl-arm64-openssl-3.0.x --version
    → should print: schema-engine-cli {hash}

#### Step 3 — Run Prisma CLI operations (always inside Alpine)
  startalpine
  cd /data/data/com.termux/files/home/fotohaven

  PRISMA_SCHEMA_ENGINE_PATH="$(pwd)/node_modules/.prisma/client/schema-engine-linux-musl-arm64-openssl-3.0.x" \
    npx prisma db push

  PRISMA_SCHEMA_ENGINE_PATH="$(pwd)/node_modules/.prisma/client/schema-engine-linux-musl-arm64-openssl-3.0.x" \
    npx prisma generate

  PRISMA_SCHEMA_ENGINE_PATH="$(pwd)/node_modules/.prisma/client/schema-engine-linux-musl-arm64-openssl-3.0.x" \
    npx prisma migrate deploy

#### Step 4 — Run the Next.js app (inside Alpine)
  All runtime Prisma queries also require the musl engine.
  Run the dev/prod server from inside Alpine, not bare Termux:

  startalpine
  cd /data/data/com.termux/files/home/fotohaven
  npm run dev
  # or: npm run build && npm run start
  # or: pm2 start ecosystem.config.js  (if pm2 installed inside Alpine)

  DO NOT run `npm run dev` from bare Termux — Prisma runtime will detect
  "debian-openssl-1.1.x", find no matching ARM64 binary, and crash.

#### Why bare Termux doesn't work for Prisma runtime
  - Termux Node.js detects runtime as "debian-openssl-1.1.x"
  - Prisma's debian-openssl-1.1.x binary is x86-64 only — unusable on ARM
  - Termux injects LD_PRELOAD=libtermux-exec-ld-preload.so (glibc symbols)
    which crashes when musl linker tries to load it
  - Alpine environment has none of these issues: native musl, correct linker,
    correct OpenSSL, no LD_PRELOAD injection

---

### prisma-android-fix.js — current status
  The postinstall script handles Steps 1 correctly (download + copy + chmod).
  It does NOT handle Step 2 (patchelf) because patchelf is only available
  inside Alpine, not in bare Termux.
  TODO: add a separate script `infra/android/prisma-alpine-patch.sh` that
  runs the patchelf commands and is executed manually after npm install:
    startalpine -c "cd /data/data/com.termux/files/home/fotohaven && sh infra/android/prisma-alpine-patch.sh"
