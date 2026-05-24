import { NextResponse } from "next/server";
import os from "os";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 1. Memory metrics
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = Math.round((usedMem / totalMem) * 100);

    // 2. CPU metrics
    const cpus = os.cpus();
    const loadAvg = os.loadavg(); // [1m, 5m, 15m]

    // 3. System info
    const uptime = os.uptime(); // in seconds
    const platform = os.platform();
    const arch = os.arch();

    // 4. DB File Size
    const dbPath = (process.env.DATABASE_URL || "file:./dev.db").replace("file:", "");
    const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
    let dbSize = 0;
    try {
      if (fs.existsSync(absoluteDbPath)) {
        dbSize = fs.statSync(absoluteDbPath).size;
      }
    } catch (e) {
      console.warn("Could not get DB size", e);
    }

    // 5. Disk usage (approximate for the current working directory)
    // On Android/Termux, we can try to get stats of the home dir
    let diskStats = { total: 0, free: 0 };
    try {
      // Note: fs.statfs is available in newer Node.js versions
      // Fallback for older environments might be needed, but we'll try it
      if (typeof (fs as any).statfsSync === 'function') {
        const stats = (fs as any).statfsSync(process.cwd());
        diskStats.total = stats.blocks * stats.bsize;
        diskStats.free = stats.bfree * stats.bsize;
      }
    } catch (e) {
      console.warn("Could not get disk stats", e);
    }

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      system: {
        platform,
        arch,
        uptime,
        nodeVersion: process.version,
        isAndroid: !!process.env.TERMUX_VERSION || platform === 'android' || (platform === 'linux' && arch === 'arm64'),
      },
      metrics: {
        memory: {
          total: totalMem,
          free: freeMem,
          used: usedMem,
          percentage: memUsage,
        },
        cpu: {
          cores: cpus.length,
          model: cpus[0]?.model || "Unknown",
          load: loadAvg,
        },
        storage: {
          dbSize,
          disk: diskStats,
        }
      }
    });

  } catch (error) {
    console.error("Health API error:", error);
    return NextResponse.json({ status: "error", error: String(error) }, { status: 500 });
  }
}
