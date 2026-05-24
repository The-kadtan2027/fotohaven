function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readEnvValue(serverName: string, publicName: string) {
  return process.env[serverName] ?? process.env[publicName];
}

function readNumber(serverName: string, publicName: string, fallback: number, min: number, max: number) {
  const parsed = Number(readEnvValue(serverName, publicName));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clampNumber(parsed, min, max);
}

function readInteger(serverName: string, publicName: string, fallback: number, min: number, max: number) {
  return Math.round(readNumber(serverName, publicName, fallback, min, max));
}

function readString(serverName: string, publicName: string, fallback: string, allowedValues: string[]) {
  const val = readEnvValue(serverName, publicName);
  if (val && allowedValues.includes(val)) {
    return val;
  }
  return fallback;
}

const strongMatchThreshold = readNumber(
  "FACE_STRONG_MATCH_THRESHOLD",
  "NEXT_PUBLIC_FACE_STRONG_MATCH_THRESHOLD",
  0.36,
  0.2,
  0.8
);

const possibleMatchThreshold = Math.max(
  strongMatchThreshold,
  readNumber(
    "FACE_POSSIBLE_MATCH_THRESHOLD",
    "NEXT_PUBLIC_FACE_POSSIBLE_MATCH_THRESHOLD",
    0.4,
    0.2,
    0.8
  )
);

export const FACE_CONFIG = {
  matchThreshold: Math.max(
    possibleMatchThreshold,
    readNumber("FACE_MATCH_THRESHOLD", "NEXT_PUBLIC_FACE_MATCH_THRESHOLD", 0.4, 0.2, 0.8)
  ),
  strongMatchThreshold,
  possibleMatchThreshold,
  enrollmentSamples: readInteger(
    "FACE_ENROLLMENT_SAMPLES",
    "NEXT_PUBLIC_FACE_ENROLLMENT_SAMPLES",
    5,
    2,
    10
  ),
  enrollmentMinSuccess: readInteger(
    "FACE_ENROLLMENT_MIN_SUCCESS",
    "NEXT_PUBLIC_FACE_ENROLLMENT_MIN_SUCCESS",
    3,
    1,
    10
  ),
  detectionMinConfidence: readNumber(
    "FACE_DETECTION_MIN_CONFIDENCE",
    "NEXT_PUBLIC_FACE_DETECTION_MIN_CONFIDENCE",
    0.5,
    0.1,
    0.99
  ),
  minFaceBoxSize: readInteger(
    "FACE_MIN_BOX_SIZE",
    "NEXT_PUBLIC_FACE_MIN_BOX_SIZE",
    48,
    8,
    512
  ),
  maxResults: readInteger("FACE_MAX_RESULTS", "NEXT_PUBLIC_FACE_MAX_RESULTS", 60, 1, 5000),
  scanSource: readString("FACE_SCAN_SOURCE", "NEXT_PUBLIC_FACE_SCAN_SOURCE", "original", ["thumbnail", "original"]),
} as const;
