// infra/android/local-storage-adapter.ts
//
// DROP-IN REPLACEMENT for src/lib/storage.ts when hosting on Android.
//
// Instead of uploading to Cloudflare R2, photos are saved directly to
// the phone's storage at ~/storage/shared/fotohaven/ (visible in Files app).
//
// HOW TO USE:
//   Replace src/lib/storage.ts with this file when running on Android.
//   Or: set STORAGE_ADAPTER=local in .env.local and import conditionally.
//
// TRADE-OFFS vs R2:
//   + No cloud costs, works fully offline on your LAN
//   + Photos accessible directly on the phone via Files app
//   - Limited by phone storage capacity
//   - Photos lost if phone dies (add backup script below)
//   - No CDN — all photo traffic goes through your phone's WiFi

import fs from "fs/promises";
import path from "path";
import { createReadStream } from "fs";
import { Readable } from "stream";

// Termux shared storage path — accessible from Android Files app
// Alternatively use: /data/data/com.termux/files/home/fotohaven-uploads
// (internal Termux storage — faster but not visible to Files app)
const UPLOAD_BASE =
  process.env.LOCAL_UPLOAD_PATH ||
  "/data/data/com.termux/files/home/storage/shared/fotohaven";

// Use relative paths instead of absolute URLs so the app works on any IP (LAN or Tailscale)
const APP_BASE_URL = "";

/**
 * Ensure a directory exists (recursive mkdir)
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Upload a file buffer to local storage
 */
export async function uploadFile(
  key: string,
  body: Buffer,
  _contentType: string
): Promise<string> {
  const filePath = path.join(UPLOAD_BASE, key);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body);
  return key;
}

/**
 * Returns a local API URL that streams the file from disk.
 * The /api/files/[...key] route handles serving.
 * "Expires" in 1 hour (honoured by the API route via Cache-Control).
 */
export async function getPresignedUrl(
  key: string,
  _expiresIn = 3600
): Promise<string> {
  // Encode the key so slashes survive URL routing
  const encodedKey = encodeURIComponent(key);
  return `${APP_BASE_URL}/api/files/${encodedKey}`;
}

/**
 * For local storage, "presigned upload" means we return a special token URL.
 * The client POSTs to /api/upload/local which writes to disk server-side.
 * (Direct PUT to the filesystem from the browser isn't possible.)
 */
export async function getPresignedUploadUrl(
  key: string,
  _contentType: string,
  _expiresIn = 900
): Promise<string> {
  // Signal to the upload API that this is a local-storage upload
  return `${APP_BASE_URL}/api/upload/local?key=${encodeURIComponent(key)}`;
}

/**
 * Delete a file from local storage
 */
export async function deleteFile(key: string): Promise<void> {
  const filePath = path.join(UPLOAD_BASE, key);
  try {
    await fs.unlink(filePath);
    // Clean up empty parent directories
    await fs.rmdir(path.dirname(filePath)).catch(() => {});
  } catch {
    // File not found — ignore
  }
}

/**
 * Return the local file path for a key
 */
export function getPublicUrl(key: string): string {
  return `${APP_BASE_URL}/api/files/${encodeURIComponent(key)}`;
}

/**
 * Build storage key (same pattern as R2 adapter — keeps DB records compatible)
 */
export function buildPhotoKey(
  albumId: string,
  ceremonyId: string,
  photoId: string,
  filename: string
): string {
  return `albums/${albumId}/ceremonies/${ceremonyId}/${photoId}/${filename}`;
}

/**
 * Get disk usage stats — useful for the health check page
 */
export async function getStorageStats(): Promise<{
  totalFiles: number;
  totalSizeBytes: number;
}> {
  let totalFiles = 0;
  let totalSizeBytes = 0;

  async function walk(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          const stat = await fs.stat(fullPath);
          totalFiles++;
          totalSizeBytes += stat.size;
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  await walk(UPLOAD_BASE);
  return { totalFiles, totalSizeBytes };
}

/**
 * Get a readable stream for a file directly from local storage.
 * Bypasses memory buffering, great for piping into Server-Side ZIP generation.
 */
export async function getFileStream(key: string): Promise<Readable> {
  const filePath = path.join(UPLOAD_BASE, key);
  return createReadStream(filePath);
}
