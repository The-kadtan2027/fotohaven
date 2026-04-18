"use client";
// src/app/page.tsx
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Image as ImageIcon, Share2, Clock, FolderOpen, Trash2, LogOut, User, Eye, Star, Settings, QrCode, X, Download } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import QRCode from "qrcode";

interface Photo {
  isReturn: boolean;
  isSelected?: boolean;
}

interface Ceremony {
  id: string;
  name: string;
  photos: Photo[];
}

interface AlbumSummary {
  id: string;
  title: string;
  clientName: string;
  shareToken: string;
  firstViewedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  totalPhotos: number;
  ceremonies: Ceremony[];
}

export default function Home() {
  const router = useRouter();
  const { toast, confirm } = useToast();
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Check auth first
    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) {
          router.replace("/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.username) {
          setUsername(data.username);
          // Fetch albums if auth is successful
          fetchAlbums();
        }
      })
      .catch((err) => {
        console.error("Auth check failed", err);
        router.replace("/login");
      });
  }, [router]);

  const fetchAlbums = () => {
    fetch("/api/albums")
      .then((r) => r.json())
      .then((data) => { setAlbums(data); setLoading(false); })
      .catch((err) => { console.error("Failed to fetch albums", err); setLoading(false); });
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login"); // Push to login gracefully
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const shareUrl = (token: string) =>
    `${window.location.origin}/share/${token}`;

  const copyLink = async (token: string) => {
    const url = shareUrl(token);
    if (navigator?.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = url;
      textArea.style.position = "absolute";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
    }
    toast("Share link copied to clipboard!", "success");
  };

  const showQr = (token: string) => {
    setQrToken(token);
    // Draw QR after the canvas mounts on next tick
    setTimeout(() => {
      const canvas = document.getElementById("qr-canvas") as HTMLCanvasElement | null;
      if (canvas) {
        QRCode.toCanvas(canvas, shareUrl(token), {
          width: 280,
          margin: 2,
          color: { dark: "#1a1208", light: "#faf7f2" },
        }).catch(console.error);
      }
    }, 50);
  };

  const downloadQr = () => {
    const canvas = document.getElementById("qr-canvas") as HTMLCanvasElement | null;
    if (!canvas || !qrToken) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `fotohaven-qr-${qrToken.slice(0, 8)}.png`;
    a.click();
  };

  const deleteAlbum = async (albumId: string) => {
    const ok = await confirm("Are you sure you want to delete this entire album and ALL photos? This action cannot be undone.");
    if (!ok) return;
    try {
      const res = await fetch(`/api/albums/${albumId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      // Remove from state immediately
      setAlbums(prev => prev.filter(a => a.id !== albumId));
      toast("Album deleted.", "success");
    } catch {
      toast("Failed to delete album.", "error");
    }
  };

  // Calculate aggregated stats
  const totalAlbums = albums.length;
  const totalPhotos = albums.reduce((sum, a) => sum + a.totalPhotos, 0);
  const totalSelections = albums.reduce((sum, a) => {
    return sum + a.ceremonies.reduce((cSum, c) => {
      return cSum + c.photos.filter(p => !p.isReturn && p.isSelected).length;
    }, 0);
  }, 0);

  // Return empty state if we don't have auth yet, preventing flash
  if (!username) {
    return <div style={{ minHeight: "100vh", background: "var(--cream)" }} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)" }}>
      {/* Header */}
      <header
        className="glass px-4 md:px-10"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          borderBottom: "1px solid var(--sand)",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, background: "var(--espresso)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ImageIcon size={16} color="var(--cream)" />
            </div>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, color: "var(--espresso)", letterSpacing: "0.02em" }}>
              FotoHaven
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--brown)" }}>
              <User size={15} />
              <span className="hidden md:inline">{username}</span>
            </div>
            <button onClick={handleLogout} className="btn-ghost" style={{ padding: "6px 12px", fontSize: 13, color: "var(--taupe)" }} title="Log out">
              <LogOut size={16} />
            </button>
            <div style={{ width: 1, height: 24, background: "var(--sand)" }} />
            <Link href="/albums/new" className="btn-primary" style={{ textDecoration: "none" }}>
              <Plus size={16} />
              <span className="hidden md:inline">New Album</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero & Stats section */}
      <section className="px-4 md:px-10 py-10 md:py-16" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: "0.15em", color: "var(--gold)", textTransform: "uppercase", marginBottom: 12 }}>
          Admin Dashboard
        </p>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 44, fontWeight: 300, color: "var(--espresso)", lineHeight: 1.1, marginBottom: 32 }}>
          Welcome back, {username}.
        </h1>
        
        {/* Stats Row */}
        {!loading && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
            <div className="card" style={{ padding: "20px 24px", minWidth: 200, flex: 1 }}>
              <p style={{ fontSize: 13, color: "var(--taupe)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Total Albums</p>
              <div style={{ fontSize: 32, fontFamily: "var(--font-display)", color: "var(--espresso)" }}>{totalAlbums}</div>
            </div>
            <div className="card" style={{ padding: "20px 24px", minWidth: 200, flex: 1 }}>
              <p style={{ fontSize: 13, color: "var(--taupe)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Total Photos</p>
              <div style={{ fontSize: 32, fontFamily: "var(--font-display)", color: "var(--espresso)" }}>{totalPhotos}</div>
            </div>
            <div className="card" style={{ padding: "20px 24px", minWidth: 200, flex: 1, borderLeft: "4px solid var(--gold)" }}>
              <p style={{ fontSize: 13, color: "var(--taupe)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Client Selections</p>
              <div style={{ fontSize: 32, fontFamily: "var(--font-display)", color: "var(--gold)" }}>{totalSelections}</div>
            </div>
          </div>
        )}
      </section>

      {/* Albums grid */}
      <main className="px-4 md:px-10 pb-20" style={{ maxWidth: 1200, margin: "0 auto" }}>
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 20 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 260, borderRadius: 16 }} />
            ))}
          </div>
        ) : albums.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 20 }}>
            {albums.map((album, i) => {
              // Calculate expiry days
              let expiryDays = null;
              if (album.expiresAt) {
                const diffTime = new Date(album.expiresAt).getTime() - new Date().getTime();
                expiryDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              }

              // Selection count
              const selTotal = album.ceremonies.reduce((cSum, c) => cSum + c.photos.filter(p => !p.isReturn && p.isSelected).length, 0);
              const origTotal = album.ceremonies.reduce((cSum, c) => cSum + c.photos.filter(p => !p.isReturn).length, 0);

              return (
                <div
                  key={album.id}
                  className="card animate-fade-up"
                  style={{ padding: 28, animationDelay: `${i * 60}ms`, animationFillMode: "both", opacity: 0, display: "flex", flexDirection: "column" }}
                >
                  {/* Card header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                    <div>
                      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--espresso)", marginBottom: 4 }}>
                        {album.title}
                      </h2>
                      <p style={{ fontSize: 13, color: "var(--brown)" }}>{album.clientName}</p>
                    </div>
                  </div>

                  {/* Ceremonies badges */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
                    {album.ceremonies.map((c) => (
                      <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brown)", background: "var(--warm-white)", padding: "3px 10px", borderRadius: 100, border: "1px solid var(--sand)" }}>
                        <FolderOpen size={11} />
                        {c.name}
                        <span style={{ color: "var(--taupe)" }}>·{c.photos.length}</span>
                      </span>
                    ))}
                  </div>

                  {/* Spacer to push footer down */}
                  <div style={{ flex: 1 }} />

                  {/* Details block */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 0", borderTop: "1px solid var(--sand)" }}>
                    {/* First Viewed */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: album.firstViewedAt ? "var(--brown)" : "var(--taupe)" }}>
                      <Eye size={14} color={album.firstViewedAt ? "var(--espresso)" : "var(--taupe)"} />
                      {album.firstViewedAt 
                        ? `Viewed ${new Date(album.firstViewedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` 
                        : "Not yet viewed"}
                    </div>

                    {/* Expiry Badge */}
                    {album.expiresAt && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: expiryDays !== null && expiryDays <= 0 ? "#dc2626" : expiryDays !== null && expiryDays <= 7 ? "#d97706" : "#16a34a" }}>
                        <Clock size={14} />
                        {expiryDays !== null && expiryDays <= 0 
                          ? "Expired" 
                          : expiryDays !== null && expiryDays <= 7 
                            ? `Expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}` 
                            : `Expires ${new Date(album.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                        }
                      </div>
                    )}

                    {/* Selection Summary */}
                    {selTotal > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--gold)", fontWeight: 500 }}>
                        <Star size={14} />
                        Client selected {selTotal} of {origTotal} photos
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, paddingTop: 16, borderTop: "1px solid var(--sand)" }}>
                    <Link
                      href={`/albums/${album.id}`}
                      className="btn-ghost"
                      style={{ flex: 1, justifyContent: "center", textDecoration: "none", fontSize: 13 }}
                    >
                      <Settings size={14} />
                      Manage
                    </Link>
                    <button
                      className="btn-gold"
                      onClick={() => copyLink(album.shareToken)}
                      style={{ flex: 1, justifyContent: "center", fontSize: 13 }}
                    >
                      <Share2 size={14} />
                      Copy Link
                    </button>
                    <button
                      onClick={() => showQr(album.shareToken)}
                      className="btn-ghost"
                      style={{ padding: "0 12px" }}
                      title="Show QR Code"
                    >
                      <QrCode size={14} />
                    </button>
                    <button
                      onClick={() => deleteAlbum(album.id)}
                      className="btn-ghost"
                      style={{ padding: "0 12px", color: "var(--blush)" }}
                      title="Delete Album"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      {qrToken && (
        <div
          onClick={() => setQrToken(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(26,18,8,0.7)",
            zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ padding: 32, textAlign: "center", maxWidth: 360, width: "100%", position: "relative" }}
          >
            <button
              onClick={() => setQrToken(null)}
              style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "var(--taupe)", display: "flex" }}
            >
              <X size={18} />
            </button>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--espresso)", marginBottom: 4 }}>Share QR Code</h3>
            <p style={{ fontSize: 12, color: "var(--taupe)", marginBottom: 24 }}>Scan to open the gallery</p>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
              <canvas
                id="qr-canvas"
                style={{ borderRadius: 12, border: "1px solid var(--sand)" }}
              />
            </div>
            <p style={{ fontSize: 11, color: "var(--taupe)", wordBreak: "break-all", marginBottom: 24, padding: "0 8px" }}>
              {shareUrl(qrToken)}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-ghost"
                onClick={() => copyLink(qrToken)}
                style={{ flex: 1, fontSize: 13, justifyContent: "center" }}
              >
                <Share2 size={13} /> Copy Link
              </button>
              <button
                className="btn-gold"
                onClick={downloadQr}
                style={{ flex: 1, fontSize: 13, justifyContent: "center" }}
              >
                <Download size={13} /> Download PNG
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-4 py-16 md:py-20 card" style={{ textAlign: "center", opacity: 0, animation: "fadeUp 0.6s ease 0.2s forwards" }}>
      <div style={{ width: 80, height: 80, background: "var(--warm-white)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
        <ImageIcon size={32} color="var(--taupe)" />
      </div>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--espresso)", marginBottom: 8 }}>
        No albums yet
      </h3>
      <p style={{ color: "var(--brown)", marginBottom: 28, fontSize: 15 }}>
        Create your first album to start sharing photos with your photographer.
      </p>
      <Link href="/albums/new" className="btn-primary" style={{ textDecoration: "none" }}>
        <Plus size={16} />
        Create your first album
      </Link>
    </div>
  );
}

