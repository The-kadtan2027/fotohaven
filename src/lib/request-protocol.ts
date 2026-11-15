/**
 * Decide whether a request reached Next.js over HTTPS.
 * Cloudflare/Tailscale set x-forwarded-proto; direct LAN HTTP does not.
 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();

  if (forwarded === "https") return true;
  if (forwarded === "http") return false;

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}
