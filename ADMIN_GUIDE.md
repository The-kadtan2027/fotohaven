# 📘 FotoHaven Photographer & Admin Guide

This guide compiles the operational procedures, startup steps, and debugging processes for maintaining the **FotoHaven** Next.js platform and the **Native Face Service** in production (Termux / Android / Linux).

---

## 🚀 Quick Start (Normal Boot Process)

Every time the phone restarts or the app is launched, run these commands in the Termux shell:

```bash
cd ~/fotohaven

# 1. Start all managed PM2 processes (Next.js, Cloudflared Tunnel, Python Face Service)
pm2 start ecosystem.config.js

# 2. View running services status
pm2 status
```

---

## 🛠️ The 5 Admin Steps You Might Forget

### 1. The Environment Gates (`.env.local`)
The Next.js app and PM2 read configuration directly from the root `.env.local` file.
* Make sure `ENABLE_NATIVE_FACE_SERVICE=1` is present to enable the Python service.
* Make sure `LOCAL_UPLOAD_PATH` matches the location where your uploaded photo assets are saved.

### 2. Node.js Upgrades & The `dlopen` ABI Crash
If you run `pkg upgrade nodejs` or update your Node version in Termux, native modules like `better-sqlite3` will crash with a symbol error (`dlopen failed`). 
**To fix this immediately, run:**
```bash
export GYP_DEFINES="android_ndk_path=''"
npm install better-sqlite3 --force
npm run build
```

### 3. Native Service Bootstrap (`build.sh`)
The Python Face Service depends on native OpenCV packages and the official ONNX deep learning models. If you deploy to a new device or wipe the folder, you **must bootstrap the models** before starting PM2:
```bash
cd ~/fotohaven/native-face-service
chmod +x build.sh
./build.sh
```
*This downloads YuNet (detection) and SFace (recognition) directly into `native-face-service/models/` and verifies your system bindings.*

### 4. Direct Foreground Debugging
If the face matching or page loading feels unresponsive, bypass PM2 and run the services in the foreground to view real-time log outputs:
* **Python Face Service:**
  ```bash
  cd ~/fotohaven/native-face-service
  python -m uvicorn main:app --host 127.0.0.1 --port 5080
  ```
* **Next.js Server:**
  ```bash
  cd ~/fotohaven
  npm run dev
  ```

### 5. Accessing logs in PM2
PM2 stores permanent execution and error logs in `~/.pm2/logs/`.
* View real-time service logs: `pm2 logs native-face-service`
* View Next.js output logs: `pm2 logs fotohaven`

---

## ✅ Verifying the `face_embeddings` Table

To confirm that the `face_embeddings` table exists in the SQLite database and is correctly structured:

1. Open a Termux shell and navigate to the project root:
   ```bash
   cd ~/fotohaven
   ```
2. Run the SQLite CLI against the database file (now `local.db`):
   ```bash
   sqlite3 local.db ".schema face_embeddings"
   ```
   You should see a CREATE TABLE statement with columns:
   - `id` (auto‑increment primary key)
   - `event_id`
   - `photo_id`
   - `face_index`
   - `embedding` (BLOB)
   - `bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`
   - `created_at`
3. List all tables to double‑check it appears:
   ```bash
   sqlite3 local.db ".tables"
   ```
   `face_embeddings` should be listed among the other tables.
4. If the table is missing, run the migration again:
   ```bash
   npx -y drizzle-kit push
   ```
   The command reads the `drizzle.config.js` where `DATABASE_URL` points to `local.db`.

These commands can be added to the **Admin Checklist** to ensure the facial‑recognition pipeline has the required storage before re‑processing photos.

---


If you have uploaded a batch of photos, or if you upgraded the face recognition models and want to regenerate the index for an album, follow this simple procedure:

### 1. Clean the Old Embeddings (If Reprocessing)
If you want to clear old/stale matches and rebuild the index completely:
1. Navigate to the Photographer Dashboard for the specific album (`/albums/[albumId]`).
2. Scroll to the **Face Management** section.
3. Click the **"Reprocess Faces"** button.
4. Confirm the prompt. This triggers a secure transaction that wipes all cached descriptors for this album from both:
   * Legcy `PhotoFace` browser tables.
   * Modern `face_embeddings` SQLite tables.

### 2. Generate New Face Embeddings
To index all photos using the Native YuNet/SFace models:
1. On the same page (`/albums/[albumId]`), click the gold **"Process Faces"** button.
2. The UI will show a loader and display a status message (e.g. `Processing...`).
3. Under the hood, this makes a fast asynchronous request to the Python service `/enroll` endpoint.
4. The service reads the local photos, extracts face coordinates, registers L2-normalized unit embeddings, updates the SQLite database, and rebuilds the in-memory cosine similarity matrix.
5. The progress bar will update in real-time. Once it completes, guests can instantly scan their selfies and find their wedding/event photos in under a millisecond!
