import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";

const GUEST_COOKIE = "guest_session";
const GUEST_TTL_SECONDS = 60 * 60 * 24;

type GuestPayload = {
  sub: string;
  albumId: string;
  email: string;
  st: string;
};

function getSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET || process.env.APP_SECRET;
  if (!raw) {
    throw new Error("JWT_SECRET or APP_SECRET is required");
  }
  return new TextEncoder().encode(raw);
}

export async function signGuestSession(payload: GuestPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${GUEST_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyGuestSession(token: string): Promise<GuestPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as GuestPayload;
}

export function getGuestCookieName() {
  return GUEST_COOKIE;
}

export function getGuestSessionMaxAgeSeconds() {
  return GUEST_TTL_SECONDS;
}
