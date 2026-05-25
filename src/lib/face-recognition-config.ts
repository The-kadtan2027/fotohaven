// Set to true to use new Python-based face recognition service.
// Set to false to fall back to the existing face-api.js system.
// Change this value to switch systems without touching any other code.
export const USE_NEW_FACE_SERVICE = true

// If new face service returns an error or is unreachable,
// automatically fall back to old system:
export const AUTO_FALLBACK_ON_ERROR = true
