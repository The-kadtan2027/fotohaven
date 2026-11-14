// src/lib/api-response.ts
import { NextResponse } from "next/server";
import { logger } from "./logger";

export interface ApiResponseOptions {
  status?: number;
  headers?: Record<string, string>;
}

export function apiSuccess<T extends Record<string, any>>(
  data?: T,
  options?: ApiResponseOptions
): NextResponse {
  const status = options?.status ?? 200;
  const payload = { ok: true, ...(data || {}) };
  return NextResponse.json(payload, { status, headers: options?.headers });
}

export function apiError(
  message: string,
  options?: ApiResponseOptions & { code?: string; details?: any }
): NextResponse {
  const status = options?.status ?? 500;
  const payload = {
    ok: false,
    error: message,
    ...(options?.code ? { code: options.code } : {}),
    ...(options?.details ? { details: options.details } : {}),
  };
  return NextResponse.json(payload, { status, headers: options?.headers });
}

export function apiBadRequest(message: string, details?: any): NextResponse {
  return apiError(message, { status: 400, code: "BAD_REQUEST", details });
}

export function apiUnauthorized(message = "Unauthorized"): NextResponse {
  return apiError(message, { status: 401, code: "UNAUTHORIZED" });
}

export function apiForbidden(message = "Forbidden"): NextResponse {
  return apiError(message, { status: 403, code: "FORBIDDEN" });
}

export function apiNotFound(message = "Resource not found"): NextResponse {
  return apiError(message, { status: 404, code: "NOT_FOUND" });
}

export function withHandler<T = any>(
  routeName: string,
  handler: (req: any, context: T) => Promise<NextResponse>
) {
  return async (req: any, context: T): Promise<NextResponse> => {
    const timer = logger.time(routeName);
    const method = req.method;
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      logger.debug("API", `[${method}] ${path} - Handler started`);
      const response = await handler(req, context);
      const duration = timer.end();
      logger.info("API", `[${method}] ${path} ${response.status} - ${duration}ms`);
      return response;
    } catch (error) {
      const duration = timer.end();
      logger.error("API", `[${method}] ${path} Exception after ${duration}ms`, error);
      return apiError("Internal server error", { status: 500 });
    }
  };
}
