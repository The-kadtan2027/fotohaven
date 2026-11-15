import test from "node:test";
import assert from "node:assert/strict";
import { hasUsableFaceDescriptor } from "../src/lib/face-descriptor";

test("rejects null and malformed descriptors", () => {
  assert.equal(hasUsableFaceDescriptor(null), false);
  assert.equal(hasUsableFaceDescriptor(""), false);
  assert.equal(hasUsableFaceDescriptor("not-json"), false);
  assert.equal(hasUsableFaceDescriptor("{}"), false);
});

test("rejects empty legacy native payloads", () => {
  assert.equal(hasUsableFaceDescriptor(JSON.stringify({ nativeMatches: [] })), false);
  assert.equal(hasUsableFaceDescriptor(JSON.stringify({ nativePhotoIds: [] })), false);
});

test("accepts non-empty native match payloads", () => {
  assert.equal(
    hasUsableFaceDescriptor(JSON.stringify({ nativeMatches: [{ photoId: "p1", score: 0.7 }] })),
    true
  );
  assert.equal(
    hasUsableFaceDescriptor(JSON.stringify({ nativePhotoIds: ["p1"] })),
    true
  );
});

test("accepts a complete float descriptor and rejects short arrays", () => {
  assert.equal(hasUsableFaceDescriptor(JSON.stringify(Array(128).fill(0.1))), true);
  assert.equal(hasUsableFaceDescriptor(JSON.stringify(Array(32).fill(0.1))), false);
});
