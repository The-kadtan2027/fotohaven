# Album Activity Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for execution tracking.

## Goal Description
Provide the photographer with deep visibility into client engagement. By tracking when guests log in, run face discovery algorithms, and download photos, we can construct a chronological "Activity Feed" inside the Photographer's Album Manager.

## Proposed Changes

---

### Database Layer
Updates to `src/lib/schema.ts` to support event recording.

#### [MODIFY] src/lib/schema.ts
- Create a new `activityLogs` table with fields: `id`, `albumId`, `guestId` (nullable), `eventType`, `payload` (text/JSON), and `createdAt`.
- Add foreign key cascades so when an Album or Guest is deleted, their logs disappear safely.
- Add it to Drizzle relations.

#### [NEW] Database Migration
- Run `npm run db:generate` and `npm run db:push` to apply the changes directly to SQLite.

---

### Backend API Layer
Create a unified sink for logging client-side events.

#### [MODIFY] src/app/api/guest/verify-otp/route.ts
- Automatically insert an `activityLogs` row for `eventType: "guest_login"` the moment the guest successfully verifies their OTP and receives a session cookie.

#### [NEW] src/app/api/guest/log-activity/route.ts
- Create a new POST endpoint authenticated by the guest session.
- Accepts `eventType` (e.g. `"face_scan"`, `"photo_download"`) and an optional `payload` (e.g., `{ count: 12 }`).
- Inserts a row into `activityLogs`.

#### [MODIFY] src/app/api/albums/[albumId]/route.ts
- Expand the photographer's Album fetch query to `LEFT JOIN` the `activityLogs` and `guests` table.
- Return the activity logs in descending order natively within the `album` JSON payload.

---

### Frontend Layer
Wire up the client triggers and build the Photographer's feed UI.

#### [MODIFY] src/app/share/[token]/guest/page.tsx
- Call `/api/guest/log-activity` locally when the `scanAndMatch` discovery finishes successfully.
- Call `/api/guest/log-activity` when the user clicks "Download" for a photo or ZIP.

#### [MODIFY] src/app/albums/[albumId]/page.tsx
- Inject an "Activity" tab next to the Ceremonies and Settings tabs.
- Build a sleek, chronological feed rendering the log payloads into human-readable sentences (e.g., "Aarav verified their email.", "Aarav downloaded 14 photos.") with relative timestamps ("2 hours ago").

## Verification Plan

### Automated Tests
- `npx tsc --noEmit` to ensure the new types (ActivityLog, nested Album payloads) remain strictly sound.
- Run `npm run db:push` cleanly without squashing existing tables.

### Manual Verification
1. Login as an Admin and view an existing Album. Try selecting the new Activity tab (should be empty).
2. Open an Incognito window and visit the Guest link.
3. Authenticate with an OTP. Run the Face Scanner. Download a photo.
4. Refresh the Admin Dashboard and confirm all events rendered chronologically with the Guest's proper name.
