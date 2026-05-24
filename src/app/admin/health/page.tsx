"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { 
  ArrowLeft, Activity, Cpu, HardDrive, Database, 
  Terminal, ShieldCheck, RefreshCw, Clock, Smartphone,
  AlertTriangle, CheckCircle2
} from "lucide-react";
import { authFetch } from "@/lib/auth";

interface HealthData {
  status: string;
  timestamp: string;
  system: {
    platform: string;
    arch: string;
    uptime: number;
    nodeVersion: string;
    isAndroid: boolean;
  };
  metrics: {
    memory: {
      total: number;
      free: number;
      used: number;
      percentage: number;
    };
    cpu: {
      cores: number;
      model: string;
      load: number[];
    };
    storage: {
      dbSize: number;
      disk: {
        total: number;
        free: number;
      };
    };
  };
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchHealth = async () => {
    try {
      setLoading(true);
      const res = await authFetch("/api/admin/health");
      if (res.status === 401) {
        window.location.href = "/"; // Redirect home to re-auth
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch health metrics");
      const json = await res.json();
      setData(json);
      setLastRefreshed(new Date());
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    
    return parts.length > 0 ? parts.join(" ") : "< 1m";
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)", padding: "0 24px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", paddingTop: 32, paddingBottom: 60 }}>
        
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <div>
            <Link href="/" className="btn-ghost" style={{ textDecoration: "none", display: "inline-flex", marginBottom: 16, fontSize: 13 }}>
              <ArrowLeft size={14} />
              Dashboard
            </Link>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 40, color: "var(--espresso)", fontWeight: 400 }}>
              System Health
            </h1>
          </div>
          <button className="btn-ghost" onClick={fetchHealth} disabled={loading} style={{ background: "#fff", border: "1px solid var(--sand)" }}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} style={{ marginRight: 8 }} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="card" style={{ background: "#fee2e2", border: "1px solid #fecaca", padding: 20, marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
            <AlertTriangle color="#dc2626" />
            <span style={{ color: "#991b1b", fontSize: 14 }}>{error}</span>
          </div>
        )}

        {data ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
            
            {/* Memory Card */}
            <div className="card animate-fade-up" style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={iconBoxStyle}><Activity size={18} color="var(--espresso)" /></div>
                  <span style={cardTitleStyle}>Memory</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: data.metrics.memory.percentage > 90 ? "var(--blush)" : "var(--gold)" }}>
                  {data.metrics.memory.percentage}%
                </span>
              </div>
              <div style={{ height: 8, background: "var(--warm-white)", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
                <div style={{ 
                  height: "100%", 
                  width: `${data.metrics.memory.percentage}%`, 
                  background: data.metrics.memory.percentage > 85 ? "var(--blush)" : "var(--gold)",
                  transition: "width 1s ease-in-out" 
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--brown)" }}>
                <span>Used: {formatBytes(data.metrics.memory.used)}</span>
                <span>Total: {formatBytes(data.metrics.memory.total)}</span>
              </div>
            </div>

            {/* Storage Card */}
            <div className="card animate-fade-up" style={{ padding: 24, animationDelay: "100ms" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <div style={iconBoxStyle}><Database size={18} color="var(--espresso)" /></div>
                <span style={cardTitleStyle}>Storage</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={statRowStyle}>
                  <span style={statLabelStyle}>Database File</span>
                  <span style={statValueStyle}>{formatBytes(data.metrics.storage.dbSize)}</span>
                </div>
                {data.metrics.storage.disk.total > 0 && (
                  <>
                    <div style={statRowStyle}>
                      <span style={statLabelStyle}>Disk (Total)</span>
                      <span style={statValueStyle}>{formatBytes(data.metrics.storage.disk.total)}</span>
                    </div>
                    <div style={statRowStyle}>
                      <span style={statLabelStyle}>Disk (Free)</span>
                      <span style={statValueStyle}>{formatBytes(data.metrics.storage.disk.free)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Performance Card */}
            <div className="card animate-fade-up" style={{ padding: 24, animationDelay: "200ms" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <div style={iconBoxStyle}><Cpu size={18} color="var(--espresso)" /></div>
                <span style={cardTitleStyle}>CPU Load</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", height: 60, gap: 8, marginBottom: 12 }}>
                {data.metrics.cpu.load.map((load, i) => (
                  <div key={i} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ 
                      height: `${Math.min(load * 20, 100)}%`, 
                      background: "var(--taupe)", 
                      borderRadius: "4px 4px 0 0",
                      minHeight: 4
                    }} />
                    <span style={{ fontSize: 10, color: "var(--taupe)", marginTop: 4 }}>{["1m", "5m", "15m"][i]}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: "var(--brown)", textAlign: "center" }}>
                {data.metrics.cpu.model} ({data.metrics.cpu.cores} cores)
              </p>
            </div>

            {/* System Info Card */}
            <div className="card animate-fade-up" style={{ padding: 24, animationDelay: "300ms", gridColumn: "1 / -1" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                <div style={iconBoxStyle}><Smartphone size={18} color="var(--espresso)" /></div>
                <span style={cardTitleStyle}>Environment</span>
                {data.system.isAndroid && (
                  <span className="tag" style={{ background: "var(--gold)", color: "#fff", border: "none" }}>Android/Termux</span>
                )}
              </div>
              
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24 }}>
                <div>
                  <div style={infoGroupStyle}>
                    <Clock size={14} style={{ marginTop: 2 }} />
                    <div>
                      <span style={infoLabelStyle}>Uptime</span>
                      <span style={infoValueStyle}>{formatUptime(data.system.uptime)}</span>
                    </div>
                  </div>
                  <div style={infoGroupStyle}>
                    <Terminal size={14} style={{ marginTop: 2 }} />
                    <div>
                      <span style={infoLabelStyle}>Node.js</span>
                      <span style={infoValueStyle}>{data.system.nodeVersion}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <div style={infoGroupStyle}>
                    <ShieldCheck size={14} style={{ marginTop: 2 }} />
                    <div>
                      <span style={infoLabelStyle}>Platform</span>
                      <span style={infoValueStyle}>{data.system.platform} / {data.system.arch}</span>
                    </div>
                  </div>
                  <div style={infoGroupStyle}>
                    <RefreshCw size={14} style={{ marginTop: 2 }} />
                    <div>
                      <span style={infoLabelStyle}>Last Updated</span>
                      <span style={infoValueStyle}>{lastRefreshed.toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>
                <div style={{ padding: 16, background: "var(--warm-white)", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                  <CheckCircle2 color="var(--gold)" size={28} style={{ marginBottom: 8 }} />
                  <span style={{ fontSize: 14, color: "var(--espresso)", fontWeight: 600 }}>System Healthy</span>
                  <span style={{ fontSize: 11, color: "var(--taupe)" }}>All subsystems operational</span>
                </div>
              </div>
            </div>

          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "100px 0" }}>
            <Loader2 className="animate-spin" size={40} color="var(--taupe)" />
            <p style={{ marginTop: 16, color: "var(--brown)" }}>Loading metrics...</p>
          </div>
        )}
      </div>
    </div>
  );
}

const iconBoxStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  background: "var(--warm-white)",
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--sand)"
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontFamily: "var(--font-display)",
  color: "var(--espresso)",
  fontWeight: 400
};

const statRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 14
};

const statLabelStyle: React.CSSProperties = {
  color: "var(--brown)"
};

const statValueStyle: React.CSSProperties = {
  color: "var(--espresso)",
  fontWeight: 600
};

const infoGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  marginBottom: 16,
  color: "var(--taupe)"
};

const infoLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 2
};

const infoValueStyle: React.CSSProperties = {
  display: "block",
  fontSize: 15,
  color: "var(--espresso)",
  fontWeight: 500
};

function Loader2({ className, size, color }: { className?: string; size?: number; color?: string }) {
  return (
    <RefreshCw className={className} size={size} color={color} />
  );
}
