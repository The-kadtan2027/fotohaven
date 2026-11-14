export type UploadStatus = "pending" | "uploading" | "error";

export interface QueuedUpload {
  id: string;
  status: UploadStatus;
  progress: number;
  error?: string;
  remotePhotoId?: string;
  uploadUrl?: string;
}

export type UploadAction<T extends QueuedUpload> =
  | { type: "enqueue"; items: T[] }
  | { type: "start"; id: string }
  | { type: "progress"; id: string; progress: number }
  | { type: "succeed"; id: string }
  | { type: "fail"; id: string; error: string }
  | { type: "retry"; id: string }
  | { type: "remove"; id: string }
  | { type: "attachRemote"; id: string; remotePhotoId: string; uploadUrl: string }
  | { type: "reset" };

function update<T extends QueuedUpload>(state: T[], id: string, patch: Partial<T>): T[] {
  let found = false;
  const next = state.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return { ...item, ...patch };
  });
  return found ? next : state;
}

/**
 * Total upload-queue transition function.
 * - Success removes the item: the server already owns it.
 * - Failure keeps the remote id so the UI can compensate (DELETE) or retry.
 * - Only Pending is uploadable; Error requires an explicit Retry.
 */
export function uploadQueueReducer<T extends QueuedUpload>(
  state: T[],
  action: UploadAction<T>
): T[] {
  switch (action.type) {
    case "enqueue":
      return [...state, ...action.items];
    case "start":
      return update(state, action.id, { status: "uploading", progress: 0, error: undefined } as Partial<T>);
    case "progress": {
      const progress = Math.max(0, Math.min(100, Math.round(action.progress)));
      const item = state.find((entry) => entry.id === action.id);
      if (!item || item.status !== "uploading") return state;
      return update(state, action.id, { progress } as Partial<T>);
    }
    case "succeed":
      return state.filter((item) => item.id !== action.id);
    case "fail": {
      const item = state.find((entry) => entry.id === action.id);
      if (!item) return state;
      return update(state, action.id, {
        status: "error",
        error: action.error,
        progress: item.progress,
      } as Partial<T>);
    }
    case "retry": {
      const item = state.find((entry) => entry.id === action.id);
      if (!item || item.status !== "error") return state;
      return update(state, action.id, { status: "pending", progress: 0, error: undefined } as Partial<T>);
    }
    case "attachRemote":
      return update(state, action.id, {
        remotePhotoId: action.remotePhotoId,
        uploadUrl: action.uploadUrl,
      } as Partial<T>);
    case "remove":
      return state.filter((item) => item.id !== action.id);
    case "reset":
      return [];
    default:
      return state;
  }
}
