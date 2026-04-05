function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clampNumber(parsed, min, max);
}

function readInteger(value: string | undefined, fallback: number, min: number, max: number) {
  return Math.round(readNumber(value, fallback, min, max));
}

const strongMatchThreshold = readNumber(
  process.env.NEXT_PUBLIC_FACE_STRONG_MATCH_THRESHOLD,
  0.36,
  0.2,
  0.8
);

const possibleMatchThreshold = Math.max(
  strongMatchThreshold,
  readNumber(process.env.NEXT_PUBLIC_FACE_POSSIBLE_MATCH_THRESHOLD, 0.4, 0.2, 0.8)
);

export const FACE_CONFIG = {
  matchThreshold: Math.max(
    possibleMatchThreshold,
    readNumber(process.env.NEXT_PUBLIC_FACE_MATCH_THRESHOLD, 0.4, 0.2, 0.8)
  ),
  strongMatchThreshold,
  possibleMatchThreshold,
  enrollmentSamples: readInteger(process.env.NEXT_PUBLIC_FACE_ENROLLMENT_SAMPLES, 5, 2, 10),
  enrollmentMinSuccess: readInteger(process.env.NEXT_PUBLIC_FACE_ENROLLMENT_MIN_SUCCESS, 3, 1, 10),
  detectionMinConfidence: readNumber(
    process.env.NEXT_PUBLIC_FACE_DETECTION_MIN_CONFIDENCE,
    0.5,
    0.1,
    0.99
  ),
  minFaceBoxSize: readInteger(process.env.NEXT_PUBLIC_FACE_MIN_BOX_SIZE, 48, 8, 512),
  maxResults: readInteger(process.env.NEXT_PUBLIC_FACE_MAX_RESULTS, 60, 1, 500),
} as const;
