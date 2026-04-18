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
    errorLogs: getRecentErrorLogs(),
  });
}
