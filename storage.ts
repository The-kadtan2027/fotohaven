// src/lib/storage.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

/**
 * Upload a file buffer to R2
 */
export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

/**
 * Generate a pre-signed URL for direct browser download (valid 1 hour)
 */
export async function getPresignedUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(r2, command, { expiresIn });
}

/**
 * Generate a pre-signed PUT URL for direct browser upload (valid 15 min)
 * Useful for large files — client uploads directly to R2, bypassing your server
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 900
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn });
}

/**
 * Delete a single object from R2
 */
export async function deleteFile(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * Build the public URL for a stored object
 * (Requires R2 bucket to have public access enabled, or use presigned URLs)
 */
export function getPublicUrl(key: string): string {
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

/**
 * Build the storage key for a photo
 * Pattern: albums/{albumId}/ceremonies/{ceremonyId}/{photoId}/{filename}
 */
export function buildPhotoKey(
  albumId: string,
  ceremonyId: string,
  photoId: string,
  filename: string
): string {
  return `albums/${albumId}/ceremonies/${ceremonyId}/${photoId}/${filename}`;
}
