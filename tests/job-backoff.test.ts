import test from "node:test";
import assert from "node:assert/strict";
import { jobDueAt, retryDelayMs } from "../src/lib/job-backoff";

test("retry delays grow exponentially", () => {
  assert.equal(retryDelayMs(1), 30_000);
  assert.equal(retryDelayMs(2), 60_000);
  assert.equal(retryDelayMs(3), 120_000);
  assert.equal(retryDelayMs(4), 240_000);
});

test("retry delay is capped", () => {
  assert.equal(retryDelayMs(10), 300_000);
  assert.equal(retryDelayMs(1000), 300_000);
});

test("invalid attempts clamp to the first delay", () => {
  assert.equal(retryDelayMs(0), 30_000);
  assert.equal(retryDelayMs(-5), 30_000);
  assert.equal(retryDelayMs(1.9), 30_000);
});

test("due time is now plus delay", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(jobDueAt(now, 2).toISOString(), "2026-01-01T00:01:00.000Z");
});
