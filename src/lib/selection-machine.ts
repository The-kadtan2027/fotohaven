export interface SelectionState {
  selected: Set<string>;
  /** Last intent version per photo. A stale PATCH result never wins. */
  versions: Record<string, number>;
  pending: Record<string, boolean>;
}

export type SelectionAction =
  | { type: "replace"; ids: string[] }
  | { type: "merge"; ids: string[] }
  | { type: "toggle"; id: string }
  | { type: "patch_ok"; id: string; version: number }
  | { type: "patch_fail"; id: string; version: number; previous: boolean }
  | { type: "set"; id: string; selected: boolean; version: number }
  | { type: "clear" };

export function initialSelection(ids: string[] = []): SelectionState {
  return {
    selected: new Set(ids),
    versions: {},
    pending: {},
  };
}

export function selectionVersion(state: SelectionState, id: string): number {
  return (state.versions[id] ?? 0) + 1;
}

function copy(state: SelectionState): SelectionState {
  return {
    selected: new Set(state.selected),
    versions: { ...state.versions },
    pending: { ...state.pending },
  };
}

export function selectionReducer(
  state: SelectionState,
  action: SelectionAction
): SelectionState {
  switch (action.type) {
    case "replace":
      return initialSelection(action.ids);

    case "merge": {
      const next = copy(state);
      for (const id of action.ids) {
        next.selected.add(id);
      }
      return next;
    }

    case "toggle": {
      const next = copy(state);
      const version = (next.versions[action.id] ?? 0) + 1;
      next.versions[action.id] = version;
      if (next.selected.has(action.id)) next.selected.delete(action.id);
      else next.selected.add(action.id);
      next.pending[action.id] = true;
      return next;
    }

    case "set": {
      if (action.version < (state.versions[action.id] ?? 0)) return state;
      const next = copy(state);
      next.versions[action.id] = action.version;
      if (action.selected) next.selected.add(action.id);
      else next.selected.delete(action.id);
      next.pending[action.id] = false;
      return next;
    }

    case "patch_ok": {
      if (action.version !== (state.versions[action.id] ?? 0)) return state;
      const next = copy(state);
      next.pending[action.id] = false;
      return next;
    }

    case "patch_fail": {
      if (action.version !== (state.versions[action.id] ?? 0)) return state;
      const next = copy(state);
      if (action.previous) next.selected.add(action.id);
      else next.selected.delete(action.id);
      next.pending[action.id] = false;
      return next;
    }

    case "clear": {
      const next = initialSelection();
      // Invalidate every in-flight PATCH so its result cannot re-add a photo.
      for (const id of Object.keys(state.versions)) {
        next.versions[id] = (state.versions[id] ?? 0) + 1;
      }
      next.versions["__epoch__"] = (state.versions["__epoch__"] ?? 0) + 1;
      return next;
    }

    default:
      return state;
  }
}
