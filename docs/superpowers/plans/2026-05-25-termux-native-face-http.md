# Termux Native Face HTTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Termux-native localhost HTTP face extraction backend that can outperform browser enrollment while preserving the current browser-first flow and pure JS on-phone matching.

**Architecture:** FotoHaven keeps browser enrollment as the default production path. A new native HTTP service, intended to run on Termux and bind to `127.0.0.1`, exposes face extraction endpoints using a mobile-friendly native runtime. Next.js calls this local service only when explicitly configured, stores returned embeddings in SQLite through existing `PhotoFace` APIs, and continues to perform guest-side matching in Node.js using cosine similarity.

**Tech Stack:** Next.js App Router, Drizzle ORM, better-sqlite3, face-api.js fallback, native localhost HTTP service, OpenCV DNN first experiment, PM2 optional process registration, SQLite, cosine similarity in TypeScript.

**Validated Termux finding:** the usable on-device OpenCV path is `apt` from the `termux-x11` repo (`opencv 4.13.0-2`, `opencv-python 4.13.0-2`), not the default `pkg` path. `cv2.dnn`, `FaceDetectorYN`, and `FaceRecognizerSF` are present in that build and a functional smoke detected 1 face in `lena.jpg` without error.

---

### Task 1: Add Native Face Backend Configuration Surface

**Files:**
- Modify: `src/lib/face-config.ts`
- Modify: `src/lib/face-recognition-config.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add native-local enrollment backend mode**

Update `src/lib/face-config.ts` so `FACE_ENROLLMENT_BACKEND` accepts `"browser" | "remote_python" | "local_native_http"` and add a localhost URL config key for the native service.

```ts
enrollmentBackend: readString(
  "FACE_ENROLLMENT_BACKEND",
  "NEXT_PUBLIC_FACE_ENROLLMENT_BACKEND",
  "browser",
  ["browser", "remote_python", "local_native_http"]
),
remoteServiceUrl: readOptionalString(
  "FACE_REMOTE_SERVICE_URL",
  "NEXT_PUBLIC_FACE_REMOTE_SERVICE_URL"
),
localNativeServiceUrl: readOptionalString(
  "FACE_LOCAL_SERVICE_URL",
  "NEXT_PUBLIC_FACE_LOCAL_SERVICE_URL"
),
```

- [ ] **Step 2: Expose a single backend decision helper**

Update `src/lib/face-recognition-config.ts` to centralize:

```ts
export const FACE_RECOGNITION_CONFIG = {
  enrollmentBackend: FACE_CONFIG.enrollmentBackend,
  remoteServiceUrl: FACE_CONFIG.remoteServiceUrl,
  localNativeServiceUrl: FACE_CONFIG.localNativeServiceUrl,
  usesRemotePythonService:
    FACE_CONFIG.enrollmentBackend === "remote_python" && Boolean(FACE_CONFIG.remoteServiceUrl),
  usesLocalNativeService:
    FACE_CONFIG.enrollmentBackend === "local_native_http" && Boolean(FACE_CONFIG.localNativeServiceUrl),
  queryMetric: FACE_CONFIG.queryMetric,
} as const;
```

- [ ] **Step 3: Extend shared album typing**

Update `src/types/index.ts` `Album`:

```ts
highThreshold?: number | null;
lowThreshold?: number | null;
faceEnrollmentBackend?: "browser" | "remote_python" | "local_native_http";
remoteFaceServiceUrl?: string | null;
localNativeServiceUrl?: string | null;
```

- [ ] **Step 4: Verify TypeScript**

Run:
```bash
cmd /c npx tsc --noEmit
```

Expected: no errors

---

### Task 2: Make Album API Return Backend Metadata

**Files:**
- Modify: `src/app/api/albums/[albumId]/route.ts`

- [ ] **Step 1: Attach backend metadata to the album response**

Extend the `albumWithUrls` object:

```ts
const albumWithUrls = {
  ...album,
  faceEnrollmentBackend: FACE_CONFIG.enrollmentBackend,
  remoteFaceServiceUrl: FACE_CONFIG.remoteServiceUrl,
  localNativeServiceUrl: FACE_CONFIG.localNativeServiceUrl,
  ceremonies: await Promise.all(/* existing mapping */),
};
```

- [ ] **Step 2: Verify TypeScript**

Run:
```bash
cmd /c npx tsc --noEmit
```

Expected: no errors

---

### Task 3: Add Native Service Proxy API

**Files:**
- Modify: `src/app/api/admin/enroll/[eventId]/route.ts`
- Modify: `src/app/api/recognize/route.ts`
- Create: `src/app/api/admin/native-face-health/route.ts`

- [ ] **Step 1: Route admin enrollment to the configured backend**

Update `src/app/api/admin/enroll/[eventId]/route.ts` so:
- `"remote_python"` uses `FACE_REMOTE_SERVICE_URL`
- `"local_native_http"` uses `FACE_LOCAL_SERVICE_URL`
- `"browser"` returns `501`

The selection helper should look like:

```ts
function getFaceServiceUrl() {
  if (FACE_CONFIG.enrollmentBackend === "remote_python" && FACE_CONFIG.remoteServiceUrl) {
    return FACE_CONFIG.remoteServiceUrl;
  }
  if (FACE_CONFIG.enrollmentBackend === "local_native_http" && FACE_CONFIG.localNativeServiceUrl) {
    return FACE_CONFIG.localNativeServiceUrl;
  }
  return null;
}
```

- [ ] **Step 2: Route recognize proxy to the configured backend**

Update `src/app/api/recognize/route.ts` to use the same URL selection logic and return:

```ts
return NextResponse.json(
  { error: "Configured face extraction service is not available." },
  { status: 501 }
);
```

when no non-browser backend is enabled.

- [ ] **Step 3: Add a simple health proxy for admin diagnostics**

Create `src/app/api/admin/native-face-health/route.ts`:

```ts
import { NextResponse } from "next/server";
import { FACE_RECOGNITION_CONFIG } from "@/lib/face-recognition-config";

export async function GET() {
  const baseUrl =
    FACE_RECOGNITION_CONFIG.usesLocalNativeService
      ? FACE_RECOGNITION_CONFIG.localNativeServiceUrl
      : FACE_RECOGNITION_CONFIG.usesRemotePythonService
        ? FACE_RECOGNITION_CONFIG.remoteServiceUrl
        : null;

  if (!baseUrl) {
    return NextResponse.json({ configured: false, healthy: false }, { status: 200 });
  }

  try {
    const response = await fetch(`${baseUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
    });
  } catch (error) {
    console.error("[GET /api/admin/native-face-health]", error);
    return NextResponse.json({ configured: true, healthy: false }, { status: 503 });
  }
}
```

- [ ] **Step 4: Verify TypeScript**

Run:
```bash
cmd /c npx tsc --noEmit
```

Expected: no errors

---

### Task 4: Update Admin UI for Three-Mode Enrollment

**Files:**
- Modify: `src/app/albums/[albumId]/page.tsx`

- [ ] **Step 1: Add local-native backend awareness**

Compute:

```ts
const usesRemoteFaceEnrollment = album?.faceEnrollmentBackend === "remote_python";
const usesLocalNativeFaceEnrollment = album?.faceEnrollmentBackend === "local_native_http";
const usesServiceEnrollment = usesRemoteFaceEnrollment || usesLocalNativeFaceEnrollment;
```

- [ ] **Step 2: Show `Process Faces` for service-backed modes only**

Replace the current conditional button with:

```tsx
{usesServiceEnrollment ? (
  <button className="btn-gold" onClick={triggerEnroll} style={{ fontSize: 12 }} disabled={enrollRunning}>
    {enrollRunning ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Camera size={12} />}
    {enrollRunning ? "Processing..." : "Process Faces"}
  </button>
) : null}
```

- [ ] **Step 3: Update the Face Recognition card copy**

Use backend-aware copy:

```tsx
<p style={{ fontSize: 12, color: "var(--brown)", marginTop: 6 }}>
  {usesRemoteFaceEnrollment
    ? "Photographer enrollment uses a remote Python service. Guest matching stays pure JS on this phone."
    : usesLocalNativeFaceEnrollment
      ? "Photographer enrollment uses a native localhost HTTP service on Termux. Guest matching stays pure JS on this phone."
      : "Photographer enrollment uses this browser with face-api.js. Guest matching stays pure JS on this phone."}
</p>
```

and metadata:

```tsx
<p style={{ fontSize: 12, color: "var(--taupe)", marginTop: 6 }}>
  Backend: <strong>{album.faceEnrollmentBackend || "browser"}</strong>
  {usesRemoteFaceEnrollment && album.remoteFaceServiceUrl ? <> · {album.remoteFaceServiceUrl}</> : null}
  {usesLocalNativeFaceEnrollment && album.localNativeServiceUrl ? <> · {album.localNativeServiceUrl}</> : null}
</p>
```

- [ ] **Step 4: Only mount `FaceProcessor` in browser mode**

Keep:

```tsx
{album.faceEnrollmentBackend !== "remote_python" && album.faceEnrollmentBackend !== "local_native_http" ? (
  <FaceProcessor photos={/* existing mapping */} />
) : null}
```

- [ ] **Step 5: Verify TypeScript**

Run:
```bash
cmd /c npx tsc --noEmit
```

Expected: no errors

---

### Task 5: Scaffold Local Native HTTP Service Workspace

**Files:**
- Create: `native-face-service/README.md`
- Create: `native-face-service/build.sh`
- Create: `native-face-service/models/.gitkeep`
- Create: `native-face-service/config.example.env`

- [ ] **Step 1: Add a README describing the experiment**

Create `native-face-service/README.md`:

```md
# Native Face Service

Experimental localhost HTTP face extraction service intended for Termux.

Initial target:
- bind to `127.0.0.1:5080`
- provide `/health`
- provide `/extract`
- later add `/extract-batch`

First runtime target:
- OpenCV DNN
- `FaceDetectorYN`
- `FaceRecognizerSF`

Verified install path:
- configure `termux-x11` apt repo
- install `opencv` + `opencv-python` via `apt`
- verify `cv2.dnn`, `cv2.FaceDetectorYN`, and `cv2.FaceRecognizerSF`
```

- [ ] **Step 2: Add a placeholder build script**

Create `native-face-service/build.sh`:

```bash
#!/data/data/com.termux/files/usr/bin/bash
set -e
echo "=== FotoHaven Native Face Service Bootstrap ==="
echo "Using verified Termux path: apt + termux-x11 OpenCV packages."

mkdir -p "${PREFIX:-/data/data/com.termux/files/usr}/etc/apt/sources.list.d"
cat > "${PREFIX:-/data/data/com.termux/files/usr}/etc/apt/sources.list.d/x11.list" <<'EOF'
deb https://packages-cf.termux.dev/apt/termux-x11/ x11 main
# deb https://packages.termux.dev/apt/termux-x11/ x11 main
EOF

apt update
apt install -y opencv opencv-python python-numpy python clang cmake ninja make pkg-config
mkdir -p models

python - <<'PY'
import cv2
assert hasattr(cv2, "dnn")
assert hasattr(cv2, "FaceDetectorYN")
assert hasattr(cv2, "FaceRecognizerSF")
print(cv2.__version__)
PY
```

- [ ] **Step 3: Add example config**

Create `native-face-service/config.example.env`:

```env
FACE_LOCAL_SERVICE_BIND=127.0.0.1
FACE_LOCAL_SERVICE_PORT=5080
FACE_DETECTOR_MODEL=./models/face_detection_yunet.onnx
FACE_RECOGNIZER_MODEL=./models/face_recognition_sface.onnx
```

- [ ] **Step 4: Verify files exist**

Run:
```bash
Get-ChildItem native-face-service -Recurse
```

Expected: README, build script, models dir, env example

---

### Task 6: Add FotoHaven Termux Rollout Notes

**Files:**
- Modify: `face-service/setup.sh`
- Create: `docs/superpowers/specs/2026-05-25-termux-native-face-http-rollout.md`

- [ ] **Step 1: Mark the Python setup script as experimental**

Add a warning at the top of `face-service/setup.sh`:

```bash
echo "WARNING: Python face-service is experimental and not the default Termux path."
echo "Preferred production mode is browser enrollment or local native HTTP enrollment."
```

- [ ] **Step 2: Add rollout notes**

Create `docs/superpowers/specs/2026-05-25-termux-native-face-http-rollout.md`:

```md
# Termux Native Face HTTP Rollout Notes

## Default production mode
- `FACE_ENROLLMENT_BACKEND=browser`

## Local native experiment mode
- `FACE_ENROLLMENT_BACKEND=local_native_http`
- `FACE_LOCAL_SERVICE_URL=http://127.0.0.1:5080`

## Remote Python experiment mode
- `FACE_ENROLLMENT_BACKEND=remote_python`
- `FACE_REMOTE_SERVICE_URL=http://<host>:<port>`

## Verified Termux OpenCV findings
- Installed packages:
  - `opencv/x11 4.13.0-2`
  - `opencv-python/x11 4.13.0-2`
  - `python-opencv-python/x11 92-1`
- Repo:
  - `deb https://packages-cf.termux.dev/apt/termux-x11/ x11 main`
- Runtime checks:
  - `hasattr(cv2, "dnn") == True`
  - `hasattr(cv2, "FaceDetectorYN") == True`
  - `hasattr(cv2, "FaceRecognizerSF") == True`
- Functional smoke:
  - detector loaded
  - recognizer loaded
  - test image detection found 1 face without error

## Operator rule
- Do not use `pkg` as the OpenCV source for the native Termux backend.
- Use `apt` with the `termux-x11` repo for OpenCV packages.
- Timing benchmarks are still pending and should be captured before performance claims are made.
```

- [ ] **Step 3: Verify TypeScript**

Run:
```bash
cmd /c npx tsc --noEmit
```

Expected: no errors

---

### Task 7: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Verify TypeScript globally**

Run:
```bash
cmd /c npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 2: Sanity check backend config surface**

Run:
```bash
cmd /c rg -n "local_native_http|FACE_LOCAL_SERVICE_URL|native-face-health" src native-face-service docs
```

Expected: matches in config, routes, UI, and rollout docs

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-25-termux-native-face-http.md docs/superpowers/specs/2026-05-25-termux-native-face-http-rollout.md native-face-service src/lib/face-config.ts src/lib/face-recognition-config.ts src/types/index.ts src/app/api/albums/[albumId]/route.ts src/app/api/admin/enroll/[eventId]/route.ts src/app/api/admin/native-face-health/route.ts src/app/api/recognize/route.ts src/app/albums/[albumId]/page.tsx face-service/setup.sh
git commit -m "feat: scaffold native Termux face HTTP backend mode"
```
