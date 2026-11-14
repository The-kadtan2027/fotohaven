const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 5 * 60_000;

/**
 * Exponential retry delay for a failed background job.
 * attempt is 1-based (the attempt that just failed).
 */
export function retryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (safeAttempt - 1));
}

export function jobDueAt(now: Date, attempt: number): Date {
  return new Date(now.getTime() + retryDelayMs(attempt));
}
