"use client";
// src/app/admin/health/page.tsx
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Activity, Database, HardDrive, Cpu, RefreshCw,
  AlertCircle, CheckCircle, Clock, Server, ChevronLeft,
  Terminal, Globe,
} from "lucide-react";

interface MemoryInfo {
  total: number;
  used: number;
  free: number;
  usedPct: number;
}

interface UptimeInfo {
  system: number;
  process: number;
}

interface PlatformInfo {
  arch: string;
  platform: string;
  cpus: number;
  loadAvg: number[];
}

interface DiskInfo {
  total: number;
  used: number;
  free: number;
}

interface Pm2Info {
  name: string;
  status: string;
  uptime: number | null;
  restarts: number;
}

interface TunnelInfo {
  provider: "cloudflare" | "tailscale" | "unknown";
  status: "online" | "offline" | "unknown";
  publicUrl: string | null;
  detail: string;
}

interface HealthData {
  timestamp: string;
  memory: MemoryInfo;
  uptime: UptimeInfo;
  platform: PlatformInfo;
  disk: DiskInfo | null;
  dbSize: number | null;
  pm2: Pm2Info | null;
  tunnel: TunnelInfo | null;
  errorLogs: string[];
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDuration(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  barPct,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  barPct?: number;
}) {
  return (
    <div
      className="card"
      style={{
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        borderLeft: accent ? `4px solid ${accent}` : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--warm-white)",
            border: "1px solid var(--sand)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={16} color={accent ?? "var(--taupe)"} />
        </div>
        <p style={{ fontSize: 12, color: "var(--taupe)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </p>
      </div>
      <p style={{ fontSize: 26, fontFamily: "var(--font-display)", color: "var(--espresso)", lineHeight: 1 }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 12, color: "var(--brown)" }}>{sub}</p>}
      {barPct !== undefined && (
        <div style={{ height: 6, background: "var(--sand)", borderRadius: 99, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${barPct}%`,
              background: barPct > 85 ? "#dc2626" : barPct > 65 ? "#d97706" : "var(--sage)",
              borderRadius: 99,
              transition: "width 0.5s ease",
            }}
          />
        </div>
      )}
    </div>
  );
}

const REFRESH_MS = 30_000;

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_MS / 1000);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const json = await res.json() as HealthData;
      setData(json);
      setError(null);
      setLastRefresh(new Date());
      setCountdown(REFRESH_MS / 1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load health data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial + auto-refresh
  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  // Countdown ticker
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? REFRESH_MS / 1000 : prev - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const na = "N/A";

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)" }}>
      {/* Header */}
      <header
        className="glass px-4 md:px-10"
        style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid var(--sand)" }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--taupe)", textDecoration: "none", fontSize: 13 }}>
              <ChevronLeft size={16} /> Dashboard
            </Link>
            <span style={{ color: "var(--sand)" }}>·</span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--espresso)", display: "flex", alignItems: "center", gap: 8 }}>
              <Activity size={18} color="var(--gold)" /> Health Monitor
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {lastRefresh && (
              <span style={{ fontSize: 12, color: "var(--taupe)" }}>
                Refreshes in {countdown}s
              </span>
            )}
            <button
              onClick={fetchHealth}
              className="btn-ghost"
              style={{ padding: "6px 12px", fontSize: 13, gap: 6 }}
              disabled={loading}
            >
              <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="px-4 md:px-10 py-8" style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Page title */}
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 12, color: "var(--gold)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
            System Status
          </p>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 36, fontWeight: 300, color: "var(--espresso)" }}>
            Health Dashboard
          </h1>
          {lastRefresh && (
            <p style={{ fontSize: 13, color: "var(--taupe)", marginTop: 4 }}>
              Last updated: {lastRefresh.toLocaleTimeString()}
            </p>
          )}
        </div>

        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", background: "rgba(220,38,38,0.08)", borderRadius: 12, border: "1px solid rgba(220,38,38,0.2)", marginBottom: 24 }}>
            <AlertCircle size={18} color="#dc2626" />
            <p style={{ fontSize: 14, color: "#dc2626" }}>{error}</p>
          </div>
        )}

        {/* Stat grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: 16, marginBottom: 24 }}>
          {/* Memory */}
          <StatCard
            icon={Cpu}
            label="Memory Used"
            value={data ? formatBytes(data.memory.used) : na}
            sub={data ? `${data.memory.usedPct}% of ${formatBytes(data.memory.total)}` : undefined}
            accent="var(--sage)"
            barPct={data?.memory.usedPct}
          />

          {/* Disk */}
          <StatCard
            icon={HardDrive}
            label="Disk Used"
            value={data?.disk ? formatBytes(data.disk.used) : na}
            sub={data?.disk ? `${Math.round((data.disk.used / data.disk.total) * 100)}% of ${formatBytes(data.disk.total)} · ${formatBytes(data.disk.free)} free` : "Not available on this platform"}
            accent="var(--gold)"
            barPct={data?.disk ? Math.round((data.disk.used / data.disk.total) * 100) : undefined}
          />

          {/* DB Size */}
          <StatCard
            icon={Database}
            label="Database Size"
            value={data?.dbSize != null ? formatBytes(data.dbSize) : na}
            sub="local.db (SQLite)"
            accent="var(--blush)"
          />

          {/* System Uptime */}
          <StatCard
            icon={Clock}
            label="System Uptime"
            value={data ? formatDuration(data.uptime.system) : na}
            sub={data ? `Process: ${formatDuration(data.uptime.process)}` : undefined}
            accent="#3b82f6"
          />

          {/* PM2 */}
          <StatCard
            icon={Server}
            label="PM2 Process"
            value={data?.pm2 ? data.pm2.status.toUpperCase() : na}
            sub={data?.pm2
              ? `${data.pm2.name} · ${data.pm2.uptime != null ? formatDuration(data.pm2.uptime / 1000) : "?"} uptime · ${data.pm2.restarts} restart${data.pm2.restarts !== 1 ? "s" : ""}`
              : "PM2 not available"}
            accent={data?.pm2?.status === "online" ? "var(--sage)" : data?.pm2 ? "#d97706" : "var(--taupe)"}
          />

          <StatCard
            icon={Globe}
            label="Public Tunnel"
            value={data?.tunnel ? data.tunnel.status.toUpperCase() : na}
            sub={data?.tunnel
              ? `${data.tunnel.provider === "unknown" ? "Tunnel" : data.tunnel.provider} · ${data.tunnel.publicUrl ?? "No URL configured"}`
              : "Not available on this platform"}
            accent={
              data?.tunnel?.status === "online"
                ? "var(--sage)"
                : data?.tunnel?.status === "offline"
                  ? "#dc2626"
                  : "var(--taupe)"
            }
          />

          {/* Platform */}
          <StatCard
            icon={Activity}
            label="Platform"
            value={data ? `${data.platform.arch}` : na}
            sub={data ? `${data.platform.platform} · ${data.platform.cpus} CPU · Load: ${data.platform.loadAvg.map((l) => l.toFixed(2)).join(", ")}` : undefined}
            accent="var(--taupe)"
          />
        </div>

        {/* Status overview row */}
        {data && (
          <div
            className="card"
            style={{ padding: "16px 24px", marginBottom: 24, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {data.pm2?.status === "online"
                ? <CheckCircle size={16} color="var(--sage)" />
                : <AlertCircle size={16} color="#d97706" />}
              <span style={{ fontSize: 13, color: "var(--brown)" }}>
                {data.pm2 ? `PM2: ${data.pm2.status}` : "PM2: not detected"}
              </span>
            </div>
            <div style={{ width: 1, height: 20, background: "var(--sand)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {data.memory.usedPct < 85
                ? <CheckCircle size={16} color="var(--sage)" />
                : <AlertCircle size={16} color="#dc2626" />}
              <span style={{ fontSize: 13, color: "var(--brown)" }}>Memory: {data.memory.usedPct}%</span>
            </div>
            <div style={{ width: 1, height: 20, background: "var(--sand)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle size={16} color="var(--sage)" />
              <span style={{ fontSize: 13, color: "var(--brown)" }}>
                DB: {data.dbSize != null ? formatBytes(data.dbSize) : "N/A"}
              </span>
            </div>
            <div style={{ width: 1, height: 20, background: "var(--sand)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {data.tunnel?.status === "online"
                ? <CheckCircle size={16} color="var(--sage)" />
                : data.tunnel?.status === "offline"
                  ? <AlertCircle size={16} color="#dc2626" />
                  : <AlertCircle size={16} color="#d97706" />}
              <span style={{ fontSize: 13, color: "var(--brown)" }}>
                {data.tunnel
                  ? `Tunnel: ${data.tunnel.status}${data.tunnel.publicUrl ? ` · ${data.tunnel.publicUrl}` : ""}`
                  : "Tunnel: N/A"}
              </span>
            </div>
          </div>
        )}

        {/* Error Logs */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Terminal size={18} color="var(--taupe)" />
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--espresso)" }}>
              Recent Error Logs
            </h2>
          </div>
          {!data || data.errorLogs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--taupe)" }}>
              <CheckCircle size={32} color="var(--sage)" style={{ marginBottom: 8, opacity: 0.7 }} />
              <p style={{ fontSize: 14 }}>No errors in the PM2 log.</p>
            </div>
          ) : (
            <div
              style={{
                background: "#1a1208",
                borderRadius: 10,
                padding: "16px",
                fontFamily: "monospace",
                fontSize: 12,
                color: "#d4c5a9",
                maxHeight: 320,
                overflowY: "auto",
                lineHeight: 1.6,
              }}
            >
              {data.errorLogs.map((line, i) => (
                <div
                  key={i}
                  style={{
                    color: line.toLowerCase().includes("error") ? "#fca5a5" : "#d4c5a9",
                    borderBottom: i < data.errorLogs.length - 1 ? "1px solid rgba(255,255,255,0.05)" : undefined,
                    paddingBottom: 4,
                    marginBottom: 4,
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
