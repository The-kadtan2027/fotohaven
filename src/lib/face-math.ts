export function parseDescriptor(json: string): Float32Array {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid descriptor JSON");
  }
  return Float32Array.from(parsed);
}

export function cosineDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Descriptor length mismatch");
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (magA === 0 || magB === 0) {
    return 1;
  }

  const similarity = dot / (Math.sqrt(magA) * Math.sqrt(magB));
  return 1 - similarity;
}

export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Descriptor length mismatch");
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = a[i] - b[i];
    sum += delta * delta;
  }

  return Math.sqrt(sum);
}

/**
 * Averages multiple 128-float face descriptors into a single representative descriptor.
 * Used for multi-sample guest enrollment — averaging 3 frames across slightly different
 * angles/lighting produces a centroid that is more robust than any single capture.
 */
export function averageDescriptors(descriptors: Float32Array[]): Float32Array {
  if (!descriptors.length) {
    throw new Error("averageDescriptors: no descriptors provided");
  }
  const len = descriptors[0].length;
  const result = new Float32Array(len);
  for (const d of descriptors) {
    if (d.length !== len) {
      throw new Error("averageDescriptors: descriptor length mismatch");
    }
    for (let i = 0; i < len; i++) {
      result[i] += d[i];
    }
  }
  for (let i = 0; i < len; i++) {
    result[i] /= descriptors.length;
  }
  return result;
}

