export type ScanPhase = "idle" | "starting" | "ready" | "capturing" | "error";

export interface ScanState {
  phase: ScanPhase;
  message: string;
}

export type ScanAction =
  | { type: "start" }
  | { type: "ready" }
  | { type: "capture" }
  | { type: "fail"; message: string }
  | { type: "retry" }
  | { type: "reset" };

export const initialScanState: ScanState = { phase: "idle", message: "" };

/**
 * Camera/scan overlay machine. Every phase except "ready" disables the shutter;
 * only "capturing" shows the in-flight status; "error" is a terminal UI state
 * with explicit exits (retry, upload, back).
 */
export function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "start":
      if (state.phase === "capturing") return state;
      return { phase: "starting", message: "" };
    case "ready":
      if (state.phase !== "starting" && state.phase !== "idle") return state;
      return { phase: "ready", message: "" };
    case "capture":
      if (state.phase !== "ready") return state;
      return { phase: "capturing", message: "" };
    case "fail":
      if (state.phase === "idle") return state;
      return { phase: "error", message: action.message };
    case "retry":
      if (state.phase !== "error") return state;
      return { phase: "starting", message: "" };
    case "reset":
      return initialScanState;
    default:
      return state;
  }
}

export function canCapture(state: ScanState): boolean {
  return state.phase === "ready";
}

export function isScanBusy(state: ScanState): boolean {
  return state.phase === "starting" || state.phase === "capturing";
}
