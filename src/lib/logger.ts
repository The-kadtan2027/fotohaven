// src/lib/logger.ts

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getActiveLogLevel(): number {
  const envLevel = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
  return LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;
}

// Redact sensitive keys from logged objects
const SENSITIVE_KEYS = ["password", "passwordhash", "code", "otp", "secret", "jwt", "token", "authorization"];

function redactSensitiveData(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map(redactSensitiveData);
  }

  const redacted: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof data[key] === "object") {
      redacted[key] = redactSensitiveData(data[key]);
    } else {
      redacted[key] = data[key];
    }
  }
  return redacted;
}

function formatPrefix(category: string, level: LogLevel): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${category.toUpperCase()}] [${level.toUpperCase()}]`;
}

export const logger = {
  debug(category: string, message: string, data?: any) {
    if (getActiveLogLevel() <= LOG_LEVELS.debug) {
      console.debug(
        formatPrefix(category, "debug"),
        message,
        data !== undefined ? redactSensitiveData(data) : ""
      );
    }
  },

  info(category: string, message: string, data?: any) {
    if (getActiveLogLevel() <= LOG_LEVELS.info) {
      console.log(
        formatPrefix(category, "info"),
        message,
        data !== undefined ? redactSensitiveData(data) : ""
      );
    }
  },

  warn(category: string, message: string, data?: any) {
    if (getActiveLogLevel() <= LOG_LEVELS.warn) {
      console.warn(
        formatPrefix(category, "warn"),
        message,
        data !== undefined ? redactSensitiveData(data) : ""
      );
    }
  },

  error(category: string, message: string, error?: any) {
    if (getActiveLogLevel() <= LOG_LEVELS.error) {
      console.error(
        formatPrefix(category, "error"),
        message,
        error !== undefined ? (error instanceof Error ? error.stack || error.message : redactSensitiveData(error)) : ""
      );
    }
  },

  time(label: string) {
    return {
      label,
      start: performance.now(),
      end() {
        const duration = Math.round(performance.now() - this.start);
        return duration;
      },
    };
  },
};
