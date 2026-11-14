import test from "node:test";
import assert from "node:assert/strict";
import { buildDuplicateGroups } from "../src/app/albums/[albumId]/album-utils";

function photo(id: string, hash: string, createdAt = "2026-01-01T00:00:00Z") {
  return { id, originalName: `${id}.jpg`, url: `/api/files/${id}.jpg`, imageHash: hash, createdAt };
}

test("groups hashes within the threshold and keeps the oldest", () => {
  // 0000... and 0000...01 differ by one bit.
  const groups = buildDuplicateGroups(
    [photo("new", "0000000000000001", "2026-01-02T00:00:00Z"), photo("old", "0000000000000000", "2026-01-01T00:00:00Z")],
    1
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].keep.id, "old");
  assert.deepEqual(groups[0].duplicates.map((p) => p.id), ["new"]);
});

test("respects the threshold", () => {
  const groups = buildDuplicateGroups([photo("a", "0000000000000000"), photo("b", "000000000000000f")], 3);
  assert.equal(groups.length, 0);
  const looser = buildDuplicateGroups([photo("a", "0000000000000000"), photo("b", "000000000000000f")], 4);
  assert.equal(looser.length, 1);
});

test("transitive duplicates form one group", () => {
  const groups = buildDuplicateGroups(
    [
      photo("a", "0000000000000000"),
      photo("b", "0000000000000001"),
      photo("c", "0000000000000003"),
    ],
    1
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].duplicates.map((p) => p.id).sort(), ["b", "c"].sort());
});

test("photos without hashes are ignored", () => {
  const groups = buildDuplicateGroups(
    [
      { id: "a", originalName: "a.jpg", url: "a", createdAt: "2026-01-01" },
      { id: "b", originalName: "b.jpg", url: "b", createdAt: "2026-01-01" },
    ],
    10
  );
  assert.deepEqual(groups, []);
});

test("groups are sorted by duplicate count", () => {
  const groups = buildDuplicateGroups(
    [
      photo("a1", "0000000000000000"),
      photo("a2", "0000000000000000"),
      photo("b1", "ffffffffffffffff"),
      photo("b2", "ffffffffffffffff"),
      photo("b3", "ffffffffffffffff"),
    ],
    0
  );
  assert.equal(groups[0].duplicates.length, 2);
  assert.equal(groups[1].duplicates.length, 1);
});
