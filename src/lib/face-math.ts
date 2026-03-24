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
