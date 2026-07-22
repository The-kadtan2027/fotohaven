import { FACE_CONFIG } from "@/lib/face-config";

export const FACE_RECOGNITION_CONFIG = {
  enrollmentBackend: FACE_CONFIG.enrollmentBackend,
  remoteServiceUrl: FACE_CONFIG.remoteServiceUrl,
  localNativeServiceUrl: FACE_CONFIG.localNativeServiceUrl,
  usesRemotePythonService:
    FACE_CONFIG.enrollmentBackend === "remote_python" && Boolean(FACE_CONFIG.remoteServiceUrl),
  usesLocalNativeService:
    FACE_CONFIG.enrollmentBackend === "local_native_http" && Boolean(FACE_CONFIG.localNativeServiceUrl),
  queryMetric: FACE_CONFIG.queryMetric,
} as const;
