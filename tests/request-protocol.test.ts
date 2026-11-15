import test from "node:test";
import assert from "node:assert/strict";
import { isSecureRequest } from "../src/lib/request-protocol";

test("uses x-forwarded-proto from the tunnel", () => {
  const https = new Request("http://localhost:3000/api/auth/login", {
    headers: { "x-forwarded-proto": "https" },
  });
  const http = new Request("http://localhost:3000/api/auth/login", {
    headers: { "x-forwarded-proto": "http" },
  });
  assert.equal(isSecureRequest(https), true);
  assert.equal(isSecureRequest(http), false);
});

test("falls back to the request URL scheme", () => {
  assert.equal(isSecureRequest(new Request("https://example.com/")), true);
  assert.equal(isSecureRequest(new Request("http://192.168.1.5:3000/")), false);
});
