import path from "path";

/**
 * Resolve a storage key inside a root directory and reject traversal.
 * The trailing separator makes `/root` and `/root2` different roots.
 */
export function resolveWithinRoot(root: string, key: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, key);

  if (resolved === resolvedRoot) return resolved;
  if (!resolved.startsWith(resolvedRoot + path.sep)) return null;
  return resolved;
}

export function withExtension(candidate: string, extension: string): string {
  return candidate.replace(/\.[^./\\]+$/, "") + extension;
}
