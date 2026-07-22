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

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  return 1 - cosineDistance(a, b);
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

/**
 * Computes Euclidean distances for N 128-float vectors stored contiguously in a matrix
 * against a target 128-float query vector.
 * Uses dot product identity ||a_i - b||^2 = ||a_i||^2 + ||b||^2 - 2(a_i · b)
 * to run in a single SIMD-friendly contiguous memory loop.
 */
export function vectorizedEuclideanDistances(
  matrix: Float32Array,
  norms: Float32Array,
  target: Float32Array,
  count: number
): Float32Array {
  if (target.length !== 128) {
    throw new Error("Target descriptor must be length 128");
  }

  // Precalculate target norm ||b||^2
  let targetNormSq = 0;
  for (let k = 0; k < 128; k++) {
    targetNormSq += target[k] * target[k];
  }

  const distances = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const offset = i * 128;
    let dot = 0;
    // Unrolled dot product loop for V8 autovectorization
    for (let k = 0; k < 128; k++) {
      dot += matrix[offset + k] * target[k];
    }
    const distSq = Math.max(0, norms[i] + targetNormSq - 2 * dot);
    distances[i] = Math.sqrt(distSq);
  }

  return distances;
}
