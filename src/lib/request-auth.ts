import { cookies } from "next/headers";
import { jwtVerify } from "jose/jwt/verify";

/** Server-side check for the photographer session cookie. */
export async function hasPhotographerSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");
  if (!sessionCookie?.value) return false;

  const secret = process.env.JWT_SECRET;
  if (!secret) return false;

  try {
    await jwtVerify(sessionCookie.value, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}
