import test from "node:test";
import assert from "node:assert/strict";
import {
  initialSelection,
  selectionReducer,
  selectionVersion,
  type SelectionState,
} from "../src/lib/selection-machine";

function toggle(state: SelectionState, id: string) {
  const version = selectionVersion(state, id);
  const previous = state.selected.has(id);
  const next = selectionReducer(state, { type: "toggle", id });
  return { state: next, version, previous, nowSelected: next.selected.has(id) };
}

test("toggle is optimistic and records a version", () => {
  const start = initialSelection();
  const { state, version, nowSelected } = toggle(start, "p1");
  assert.equal(nowSelected, true);
  assert.equal(version, 1);
  assert.equal(state.pending.p1, true);
});

test("successful patch clears pending without changing value", () => {
  const { state, version } = toggle(initialSelection(), "p1");
  const done = selectionReducer(state, { type: "patch_ok", id: "p1", version });
  assert.equal(done.pending.p1, false);
  assert.equal(done.selected.has("p1"), true);
});

test("failed patch rolls back to the previous value", () => {
  const { state, version } = toggle(initialSelection(["p1"]), "p1");
  assert.equal(state.selected.has("p1"), false);
  const failed = selectionReducer(state, {
    type: "patch_fail",
    id: "p1",
    version,
    previous: true,
  });
  assert.equal(failed.selected.has("p1"), true);
  assert.equal(failed.pending.p1, false);
});

test("stale failure cannot overwrite a newer intent", () => {
  const first = toggle(initialSelection(), "p1");
  const second = toggle(first.state, "p1");
  assert.equal(second.version, 2);
  assert.equal(second.state.selected.has("p1"), false);

  const stale = selectionReducer(second.state, {
    type: "patch_fail",
    id: "p1",
    version: first.version,
    previous: false,
  });
  assert.equal(stale.selected.has("p1"), false, "newer intent wins");

  const latest = selectionReducer(stale, {
    type: "patch_fail",
    id: "p1",
    version: second.version,
    previous: true,
  });
  assert.equal(latest.selected.has("p1"), true, "latest failure rolls back");
});

test("replace rehydrates from the server", () => {
  const { state } = toggle(initialSelection(), "p1");
  const replaced = selectionReducer(state, { type: "replace", ids: ["p2", "p3"] });
  assert.deepEqual([...replaced.selected].sort(), ["p2", "p3"]);
  assert.deepEqual(replaced.pending, {});
});

test("clear resets values and invalidates in-flight results", () => {
  const { state, version } = toggle(initialSelection(), "p1");
  const cleared = selectionReducer(state, { type: "clear" });
  assert.equal(cleared.selected.size, 0);
  const late = selectionReducer(cleared, {
    type: "patch_fail",
    id: "p1",
    version,
    previous: false,
  });
  assert.equal(late.selected.size, 0, "late result is ignored");
});

test("set applies a versioned value and ignores older versions", () => {
  const start = initialSelection();
  const v = selectionVersion(start, "p1");
  const selected = selectionReducer(start, { type: "set", id: "p1", selected: true, version: v });
  assert.equal(selected.selected.has("p1"), true);

  const stale = selectionReducer(selected, { type: "set", id: "p1", selected: false, version: v - 1 });
  assert.equal(stale.selected.has("p1"), true, "older version is ignored");
});
