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

**Status:** Not started  
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
- [ ] Photographer can upload from the share page without any account
- [ ] Returned photos appear in a separate "Finals" section
- [ ] Client can download returned photos as ZIP
- [ ] Original and returned photos don't mix in the gallery

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
