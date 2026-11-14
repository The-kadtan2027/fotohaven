import test from "node:test";
import assert from "node:assert/strict";
import { uploadQueueReducer, type QueuedUpload } from "../src/lib/upload-queue";

type Item = QueuedUpload & { name: string };

function item(id: string): Item {
  return { id, name: id, status: "pending", progress: 0 };
}

test("enqueue appends items and keeps order", () => {
  const state = uploadQueueReducer<Item>([], { type: "enqueue", items: [item("a"), item("b")] });
  assert.deepEqual(state.map((entry) => entry.id), ["a", "b"]);
});

test("start -> progress -> succeed removes the item", () => {
  let state = uploadQueueReducer<Item>([item("a")], { type: "start", id: "a" });
  assert.equal(state[0].status, "uploading");
  state = uploadQueueReducer(state, { type: "progress", id: "a", progress: 42.6 });
  assert.equal(state[0].progress, 43);
  state = uploadQueueReducer(state, { type: "succeed", id: "a" });
  assert.equal(state.length, 0);
});

test("progress for a non-uploading item is ignored", () => {
  const state = uploadQueueReducer<Item>([item("a")], { type: "progress", id: "a", progress: 80 });
  assert.equal(state[0].progress, 0);
  assert.equal(state[0].status, "pending");
});

test("progress is clamped to 0..100", () => {
  let state = uploadQueueReducer<Item>([item("a")], { type: "start", id: "a" });
  state = uploadQueueReducer(state, { type: "progress", id: "a", progress: 999 });
  assert.equal(state[0].progress, 100);
  state = uploadQueueReducer(state, { type: "progress", id: "a", progress: -5 });
  assert.equal(state[0].progress, 0);
});

test("fail keeps the remote photo id for compensation", () => {
  let state = uploadQueueReducer<Item>([item("a")], { type: "start", id: "a" });
  state = uploadQueueReducer(state, {
    type: "attachRemote",
    id: "a",
    remotePhotoId: "photo-1",
    uploadUrl: "/api/upload/local?key=x",
  });
  state = uploadQueueReducer(state, { type: "fail", id: "a", error: "HTTP 502" });
  assert.equal(state[0].status, "error");
  assert.equal(state[0].error, "HTTP 502");
  assert.equal(state[0].remotePhotoId, "photo-1");
});

test("retry is only legal from error", () => {
  const pending = [item("a")];
  assert.equal(uploadQueueReducer(pending, { type: "retry", id: "a" })[0].status, "pending");

  let errorState = uploadQueueReducer<Item>(pending, { type: "start", id: "a" });
  errorState = uploadQueueReducer(errorState, { type: "fail", id: "a", error: "x" });
  const retried = uploadQueueReducer(errorState, { type: "retry", id: "a" });
  assert.equal(retried[0].status, "pending");
  assert.equal(retried[0].error, undefined);
});

test("remove and reset are total", () => {
  const removed = uploadQueueReducer<Item>([item("a")], { type: "remove", id: "a" });
  assert.equal(removed.length, 0);
  assert.deepEqual(uploadQueueReducer<Item>([item("a")], { type: "reset" }), []);
});

test("unknown ids never throw or mutate", () => {
  const state = [item("a")];
  assert.deepEqual(uploadQueueReducer(state, { type: "start", id: "missing" }), state);
  assert.deepEqual(uploadQueueReducer(state, { type: "fail", id: "missing", error: "x" }), state);
  assert.deepEqual(uploadQueueReducer(state, { type: "succeed", id: "missing" }), state);
});
