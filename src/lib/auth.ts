/**
 * Helper to manage APP_SECRET for admin access
 */

const SECRET_KEY = "fotohaven_admin_secret";

export function getAppSecret(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SECRET_KEY);
}

export function setAppSecret(secret: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SECRET_KEY, secret);
}

export function clearAppSecret() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SECRET_KEY);
}

/**
 * Authenticated fetch wrapper
 */
export async function authFetch(url: string, options: RequestInit = {}) {
  const secret = getAppSecret();
  const headers = new Headers(options.headers || {});
  
  if (secret) {
    headers.set("Authorization", `Bearer ${secret}`);
  }

  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    // If we catch a 401 on an admin route, it means the secret is wrong or missing
    // We don't clear it immediately to allow the user to see they are unauthorized
    // but the UI should probably prompt for it.
  }
  
  return response;
}
