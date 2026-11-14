import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";

const UPLOAD_TOKEN_TTL = "15m";

function getSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET || process.env.APP_SECRET;
  if (!raw) {
    throw new Error("JWT_SECRET or APP_SECRET is required for upload tokens");
  }
  return new TextEncoder().encode(raw);
}

/**
 * The local storage adapter returns a same-origin PUT URL. That route is
 * admin-guarded, which would break the unauthenticated share-page upload flow.
 * Sign a short-lived, key-bound token so the route can authorize exactly one
 * upload target without a session cookie.
 */
export async function authorizeLocalUploadUrl(uploadUrl: string, storageKey: string): Promise<string> {
  if (!uploadUrl.startsWith("/api/upload/local")) {
    return uploadUrl;
  }

  const token = await new SignJWT({ key: storageKey })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(UPLOAD_TOKEN_TTL)
    .sign(getSecret());

  const separator = uploadUrl.includes("?") ? "&" : "?";
  return `${uploadUrl}${separator}token=${encodeURIComponent(token)}`;
}

export async function verifyUploadToken(token: string, storageKey: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.key === storageKey;
  } catch {
    return false;
  }
}
