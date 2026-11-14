import test from "node:test";
import assert from "node:assert/strict";
import {
  clearRateLimit,
  consumeRateLimit,
  isRateLimited,
  rateLimitKey,
  resetRateLimits,
  retryAfterSeconds,
} from "../src/lib/rate-limit";

test("allows up to the limit inside the window", () => {
  resetRateLimits();
  const key = "test:a";
  const options = { limit: 3, windowMs: 1000 };
  assert.equal(consumeRateLimit(key, options, 0).allowed, true);
  assert.equal(consumeRateLimit(key, options, 100).allowed, true);
  const third = consumeRateLimit(key, options, 200);
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);

  const blocked = consumeRateLimit(key, options, 300);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
  assert.equal(retryAfterSeconds(blocked), "1");
});

test("blocked attempts extend the lockout", () => {
  resetRateLimits();
  const options = { limit: 1, windowMs: 1000 };
  assert.equal(consumeRateLimit("test:b", options, 0).allowed, true);
  assert.equal(consumeRateLimit("test:b", options, 900).allowed, false);
  assert.equal(consumeRateLimit("test:b", options, 1500).allowed, false, "old hit still in window via blocked hit");
});

test("window slides after expiry", () => {
  resetRateLimits();
  const options = { limit: 1, windowMs: 1000 };
  assert.equal(consumeRateLimit("test:c", options, 0).allowed, true);
  assert.equal(consumeRateLimit("test:c", options, 1001).allowed, true);
});

test("success clear resets the bucket", () => {
  resetRateLimits();
  const options = { limit: 1, windowMs: 1000 };
  consumeRateLimit("test:d", options, 0);
  clearRateLimit("test:d");
  assert.equal(consumeRateLimit("test:d", options, 1).allowed, true);
});

test("isRateLimited reads without recording", () => {
  resetRateLimits();
  const options = { limit: 1, windowMs: 1000 };
  assert.equal(isRateLimited("test:e", options, 0).allowed, true);
  assert.equal(isRateLimited("test:e", options, 0).allowed, true, "peek does not count");
  consumeRateLimit("test:e", options, 0);
  assert.equal(isRateLimited("test:e", options, 1).allowed, false);
});

test("keys are normalized and scoped", () => {
  assert.equal(rateLimitKey("otp", " A@B.com ", "Album"), "otp:a@b.com:album");
  assert.notEqual(rateLimitKey("login", "1.2.3.4", "a"), rateLimitKey("otp", "1.2.3.4", "a"));
});
