import { FACE_CONFIG } from "@/lib/face-config";

export const FACE_RECOGNITION_CONFIG = {
  enrollmentBackend: FACE_CONFIG.enrollmentBackend,
  remoteServiceUrl: FACE_CONFIG.remoteServiceUrl,
  usesRemotePythonService:
    FACE_CONFIG.enrollmentBackend === "remote_python" && Boolean(FACE_CONFIG.remoteServiceUrl),
  queryMetric: FACE_CONFIG.queryMetric,
} as const;
