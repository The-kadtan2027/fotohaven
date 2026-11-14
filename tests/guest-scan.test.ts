import test from "node:test";
import assert from "node:assert/strict";
import {
  canCapture,
  initialScanState,
  isScanBusy,
  scanReducer,
} from "../src/lib/guest-scan";

test("happy path idle -> starting -> ready -> capturing", () => {
  let state = scanReducer(initialScanState, { type: "start" });
  assert.equal(state.phase, "starting");
  assert.equal(isScanBusy(state), true);
  state = scanReducer(state, { type: "ready" });
  assert.equal(state.phase, "ready");
  assert.equal(canCapture(state), true);
  state = scanReducer(state, { type: "capture" });
  assert.equal(state.phase, "capturing");
  assert.equal(canCapture(state), false);
});

test("camera failure exposes a message and a retry", () => {
  let state = scanReducer(initialScanState, { type: "start" });
  state = scanReducer(state, { type: "fail", message: "Camera access is blocked" });
  assert.equal(state.phase, "error");
  assert.equal(state.message, "Camera access is blocked");
  state = scanReducer(state, { type: "retry" });
  assert.equal(state.phase, "starting");
  assert.equal(state.message, "");
});

test("impossible events are ignored, not applied", () => {
  const ready = scanReducer(scanReducer(initialScanState, { type: "start" }), { type: "ready" });
  assert.deepEqual(scanReducer(ready, { type: "retry" }), ready);
  assert.deepEqual(scanReducer(ready, { type: "ready" }), ready);
  assert.deepEqual(scanReducer(initialScanState, { type: "fail", message: "x" }), initialScanState);
  assert.deepEqual(scanReducer(initialScanState, { type: "capture" }), initialScanState);
});

test("reset returns to idle", () => {
  const state = scanReducer(scanReducer(initialScanState, { type: "start" }), {
    type: "fail",
    message: "x",
  });
  assert.deepEqual(scanReducer(state, { type: "reset" }), initialScanState);
});
