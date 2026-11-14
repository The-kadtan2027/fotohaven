import test from "node:test";
import assert from "node:assert/strict";
import { authorizeLocalUploadUrl, verifyUploadToken } from "../src/lib/upload-token";

process.env.JWT_SECRET = "test-upload-token-secret-at-least-32-characters";

function tokenFromUrl(url: string): string {
  const parsed = new URL(url, "http://localhost");
  return parsed.searchParams.get("token") ?? "";
}

test("signs a local upload URL bound to the storage key", async () => {
  const key = "albums/a/ceremonies/b/photo/image.jpg";
  const url = await authorizeLocalUploadUrl(`/api/upload/local?key=${encodeURIComponent(key)}`, key);
  const token = tokenFromUrl(url);
  assert.ok(token.length > 20);
  assert.equal(await verifyUploadToken(token, key), true);
});

test("rejects a token for a different key", async () => {
  const key = "albums/a/photo.jpg";
  const url = await authorizeLocalUploadUrl(`/api/upload/local?key=${encodeURIComponent(key)}`, key);
  const token = tokenFromUrl(url);
  assert.equal(await verifyUploadToken(token, "albums/other.jpg"), false);
});

test("rejects malformed tokens", async () => {
  assert.equal(await verifyUploadToken("not-a-jwt", "albums/a.jpg"), false);
});

test("leaves non-local (R2) upload URLs untouched", async () => {
  const url = "https://bucket.example.com/albums/a.jpg?X-Amz-Signature=abc";
  assert.equal(await authorizeLocalUploadUrl(url, "albums/a.jpg"), url);
});
