/**
 * A descriptor row can be a legacy empty object such as
 * `{"nativePhotoIds":[]}` or `{"nativeMatches":[]}`. Those must not count as
 * "this guest already completed a face scan".
 */
export function hasUsableFaceDescriptor(raw: string | null | undefined): boolean {
  if (!raw) return false;

  try {
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return (
        parsed.length >= 64 &&
        parsed.every((value) => typeof value === "number" && Number.isFinite(value))
      );
    }

    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.nativeMatches)) return record.nativeMatches.length > 0;
      if (Array.isArray(record.nativePhotoIds)) return record.nativePhotoIds.length > 0;
    }

    return false;
  } catch {
    return false;
  }
}
