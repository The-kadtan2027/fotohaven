import { apiError } from "@/lib/api-response";
import {
  consumeRateLimit,
  isRateLimited,
  rateLimitKey,
  retryAfterSeconds,
  type RateLimitOptions,
  type RateLimitResult,
} from "@/lib/rate-limit";

export const OTP_SEND_IDENTITY: RateLimitOptions = { limit: 3, windowMs: 10 * 60_000 };
export const OTP_SEND_IP: RateLimitOptions = { limit: 10, windowMs: 10 * 60_000 };
export const OTP_VERIFY_IDENTITY: RateLimitOptions = { limit: 5, windowMs: 10 * 60_000 };
export const OTP_VERIFY_IP: RateLimitOptions = { limit: 20, windowMs: 10 * 60_000 };
export const LOGIN_IDENTITY: RateLimitOptions = { limit: 5, windowMs: 15 * 60_000 };

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function otpIdentityKey(email: string, albumId: string) {
  return rateLimitKey("otp-identity", albumId, email);
}

export function otpIpKey(ip: string) {
  return rateLimitKey("otp-ip", ip);
}

export function loginIdentityKey(ip: string, username: string) {
  return rateLimitKey("login", ip, username);
}

export function tooManyRequests(result: RateLimitResult, message: string) {
  return apiError(message, {
    status: 429,
    code: "RATE_LIMITED",
    headers: { "Retry-After": retryAfterSeconds(result) },
  });
}

export { consumeRateLimit, isRateLimited };
