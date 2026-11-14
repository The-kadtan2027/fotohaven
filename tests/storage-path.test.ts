import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveWithinRoot, withExtension } from "../src/lib/storage-path";

const root = path.resolve("/data/fotohaven");

test("resolves normal nested keys", () => {
  assert.equal(
    resolveWithinRoot(root, "albums/a/ceremonies/b/c.jpg"),
    path.join(root, "albums/a/ceremonies/b/c.jpg")
  );
});

test("rejects parent traversal", () => {
  assert.equal(resolveWithinRoot(root, "../fotohaven2/secret.jpg"), null);
  assert.equal(resolveWithinRoot(root, "../../etc/passwd"), null);
});

test("rejects absolute keys that escape the root", () => {
  assert.equal(resolveWithinRoot(root, path.resolve("/etc/passwd")), null);
});

test("sibling directory with the same prefix is not inside", () => {
  assert.equal(resolveWithinRoot(root, "../fotohaven2/x"), null);
});

test("root itself is allowed but does not expose files", () => {
  assert.equal(resolveWithinRoot(root, "."), root);
});

test("withExtension replaces only the final extension", () => {
  assert.equal(withExtension("/a/b/c.jpg", ".webp"), "/a/b/c.webp");
  assert.equal(withExtension("/a/b/c", ".webp"), "/a/b/c.webp");
  assert.equal(withExtension("/a.b/c.jpg", ".png"), "/a.b/c.png");
});
