# Face scan review — 2026-11-15

Scope: guest camera/upload scan, `/api/recognize`, native fastapi service, and
the guest session/descriptor lifecycle.

## Reported symptom

Scanning took a long time and returned no usable result. The production logs
showed repeated `/api/recognize` requests and a stored guest descriptor of
**`{"nativeMatches":[]}`** for the affected guest.

## Confirmed root causes

1. **An empty match list was treated as a completed face profile.**
   `verify-otp` returned `hasFaceDescriptor: Boolean(existingGuest.faceDescriptor)`,
   so `{"nativeMatches":[]}` counted as “already scanned”. The page skipped
   consent/scan and loaded an empty result set. The same empty object was written
   by `enroll-face` when the native search returned zero matches.

2. **No-face frames were silently converted into an embedding.**
   `extract_query_embedding` fell back to resizing the whole image to 112×112
   when YuNet found no face. That produced a meaningless vector, a normal 200
   response, and usually zero matches. The guest UI had no “no face” state.

3. **The query detector threshold was too strict.**
   YuNet was created with `FACE_DETECTION_SCORE_THRESHOLD=0.9` for both album
   enrollment and selfie queries. Angled/low-light selfies can score below 0.9,
   producing the no-face fallback above.

4. **The browser face-api fallback made failures slow and silent.**
   Any native error (including 422/no-face) fell through to loading face-api.js
   models and running a second detector in the browser. On a phone this can take
   many seconds; the final `enroll-face` could still fail, leaving the descriptor
   empty.

5. **Secure cookies broke LAN HTTP testing.**
   Admin/guest cookies were `Secure` whenever `NODE_ENV=production`, even when
   the page was opened on `http://192.168.1.5:3000`. Browsers drop those cookies
   on HTTP, which makes `/api/recognize` and `/enroll-face` fail on the LAN.

## Changes

- `hasUsableFaceDescriptor()` (`src/lib/face-descriptor.ts`) treats empty or
  legacy empty payloads (`nativeMatches: []`, `nativePhotoIds: []`) as absent.
  `verify-otp` now returns `hasFaceDescriptor: false` for them, so the guest
  gets the consent/scan flow again.
- `enroll-face` rejects empty `nativeMatches`/`nativePhotoIds` with `400`
  instead of overwriting a profile with nothing.
- Native `/search` raises `NoFaceDetected` and returns **422** with
  `{code:"NO_FACE", error:"No face detected..."}`; no image-wide fallback.
- Query detection uses `FACE_QUERY_SCORE_THRESHOLD=0.6`; album enrollment still
  filters at the stricter `FACE_DETECTION_SCORE_THRESHOLD=0.9`.
- `/search` now returns `faces_detected`, `best_score`, `indexed_faces` and
  decode/query/search timings, and logs a one-line `[native-search]` record.
- Guest page removes the silent browser fallback. Recognition is a single native
  call with a 15 s timeout, enrollment has a 15 s timeout, match loading has a
  20 s timeout, and no-face/zero-match/session-expired cases get actionable
  scan-error copy with Retry/Upload/Back.
- Uploaded-photo enrollment rejects `faces_detected > 1`; camera scans may pick
  the best face in a group.
- `isSecureRequest()` sets cookies `Secure` only when `x-forwarded-proto` is
  `https` (or the URL scheme is https). Direct LAN HTTP now authenticates
  correctly; Cloudflare HTTPS still gets Secure cookies.

## Verification

| Case | Result |
|---|---|
| Blank 640×480 frame | `/api/recognize` **422** in 244 ms, `NO_FACE` |
| Real album face (2 faces) | **200** in 839 ms; `faces_detected=2`, `best=1.0`, 45 definite / 7 possible |
| Native logs | `[native-search] ... NO_FACE ...` and `... faces=2 ... query=590ms search=42ms` |
| Guest UI, blank upload | inline “No face detected. Center your face in the oval and try again.” in under 1 s |
| Guest UI, single-face upload | Quick Review → Skip → **113 matched photos**, “Welcome, Audit UI” |
| Empty enroll payload | **400** `No face matches to save. Retry the scan.` |
| Broken descriptor | `{"nativeMatches":[]}` → `hasFaceDescriptor=false` (unit test) |
| LAN cookie | no `Secure` on direct HTTP; `Secure` with `x-forwarded-proto: https` |

Test guests, OTP rows and activity rows were removed after verification.
Production `GUEST_OTP_BYPASS` remained `false`.

## Remaining note

The affected guest's existing row still contains the legacy empty descriptor.
The new `hasUsableFaceDescriptor` treats it as absent, so the next OTP
verification shows consent/scan; a successful scan replaces it with real
matches. No cleanup of that row is required.
