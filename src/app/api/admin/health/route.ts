// src/app/api/admin/health/route.ts
// Auth: guarded by middleware (session cookie required).
// Returns system health metrics using only Node.js built-ins (no native modules — ARM safe).

import { NextResponse } from "next/server";
import os from "os";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

function safeExec(cmd: string): string | null {
  try {
    return execSync(cmd, { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
  } catch {
    return null;
  }
}

function getDiskUsage(): { used: number; free: number; total: number } | null {
  try {
    // Works on Linux/Android (Termux). Returns KB values.
    const output = safeExec("df -k /");
    if (!output) return null;
    const lines = output.split("\n");
    const dataLine = lines[1]; // second line has numbers
    if (!dataLine) return null;
    const parts = dataLine.trim().split(/\s+/);
    // Filesystem  1K-blocks  Used  Available  Use%  Mounted
    const total = parseInt(parts[1], 10) * 1024;
    const used = parseInt(parts[2], 10) * 1024;
    const free = parseInt(parts[3], 10) * 1024;
    if (isNaN(total) || isNaN(used) || isNaN(free)) return null;
    return { total, used, free };
  } catch {
    return null;
  }
}

function getDbSize(): number | null {
  try {
    const dbPath = process.env.DATABASE_URL?.replace("file:", "") 
      ?? path.join(process.cwd(), "local.db");
    const stat = fs.statSync(dbPath);
    return stat.size;
  } catch {
    return null;
  }
}

function getPm2Info(): { name: string; status: string; uptime: number | null; restarts: number } | null {
  try {
    const raw = safeExec("pm2 jlist");
    if (!raw) return null;
    const list = JSON.parse(raw) as Array<{
      name: string;
      pm2_env: { status: string; pm_uptime: number; restart_time: number };
    }>;
    const proc = list.find((p) => p.name === "fotohaven") ?? list[0];
    if (!proc) return null;
    const uptimeMs = proc.pm2_env.pm_uptime
      ? Date.now() - proc.pm2_env.pm_uptime
      : null;
    return {
      name: proc.name,
      status: proc.pm2_env.status,
      uptime: uptimeMs,
      restarts: proc.pm2_env.restart_time ?? 0,
    };
  } catch {
    return null;
  }
}

function getRecentErrorLogs(): string[] {
  try {
    // PM2 log location — common paths
    const candidates = [
      path.join(os.homedir(), ".pm2/logs/fotohaven-error.log"),
      path.join(os.homedir(), ".pm2/logs/fotohaven-error-0.log"),
    ];
    for (const logPath of candidates) {
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        return lines.slice(-20); // last 20 lines
      }
    }
    return [];
  } catch {
    return [];
  }
}

type TunnelInfo = {
  provider: "cloudflare" | "tailscale" | "unknown";
  status: "online" | "offline" | "unknown";
  publicUrl: string | null;
  detail: string;
};

function inferTunnelProvider(publicUrl: string | null): TunnelInfo["provider"] {
  if (!publicUrl) return "unknown";
  if (publicUrl.includes("trycloudflare.com")) return "cloudflare";
  if (publicUrl.includes(".ts.net")) return "tailscale";
  return "unknown";
}

function getTunnelInfo(): TunnelInfo | null {
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || null;
  const pm2Raw = safeExec("pm2 jlist");

  if (pm2Raw) {
    try {
      const list = JSON.parse(pm2Raw) as Array<{
        name: string;
        pm2_env?: { status?: string };
      }>;

      const cloudflaredProc = list.find((proc) => proc.name.toLowerCase().includes("cloudflared"));
      if (cloudflaredProc) {
        const status = cloudflaredProc.pm2_env?.status === "online" ? "online" : "offline";
        return {
          provider: "cloudflare",
          status,
          publicUrl,
          detail: status === "online"
            ? "cloudflared is running under PM2"
            : "cloudflared process exists but is not online",
        };
      }

      const tailscaleProc = list.find((proc) => proc.name.toLowerCase().includes("tailscale"));
      if (tailscaleProc) {
        const status = tailscaleProc.pm2_env?.status === "online" ? "online" : "offline";
        return {
          provider: "tailscale",
          status,
          publicUrl,
          detail: status === "online"
            ? "Tailscale process is running under PM2"
            : "Tailscale process exists but is not online",
        };
      }
    } catch {
      // Fall through to command-based detection.
    }
  }

  const cloudflaredProcess = safeExec("pgrep -af cloudflared");
  if (cloudflaredProcess) {
    return {
      provider: "cloudflare",
      status: "online",
      publicUrl,
      detail: "cloudflared process detected",
    };
  }

  const tailscaleProcess = safeExec("pgrep -af tailscale");
  if (tailscaleProcess) {
    return {
      provider: "tailscale",
      status: "online",
      publicUrl,
      detail: "Tailscale process detected",
    };
  }

  if (publicUrl) {
    return {
      provider: inferTunnelProvider(publicUrl),
      status: "unknown",
      publicUrl,
      detail: "Public URL is configured, but tunnel process could not be detected on this platform",
    };
  }

  return {
    provider: "unknown",
    status: "unknown",
    publicUrl: null,
    detail: "No public tunnel URL configured",
  };
}

export async function GET() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usedPct: Math.round((usedMem / totalMem) * 100),
    },
    uptime: {
      system: os.uptime(),      // seconds
      process: process.uptime(), // seconds
    },
    platform: {
      arch: os.arch(),
      platform: os.platform(),
      cpus: os.cpus().length,
      loadAvg: os.loadavg(),
    },
    disk: getDiskUsage(),
    dbSize: getDbSize(),
    pm2: getPm2Info(),
    tunnel: getTunnelInfo(),
    errorLogs: getRecentErrorLogs(),
  });
}
