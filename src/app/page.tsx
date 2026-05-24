"use client";
// src/app/page.tsx
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Image, Share2, Clock, FolderOpen, Trash2, ShieldCheck, Loader2, Lock } from "lucide-react";
import { authFetch, getAppSecret, setAppSecret } from "@/lib/auth";

interface AlbumSummary {
  id: string;
  title: string;
  clientName: string;
  shareToken: string;
  expiresAt: string | null;
  createdAt: string;
  totalPhotos: number;
  totalFinals: number;
  ceremonies: { id: string; name: string; photoCount: number; finalCount: number }[];
}

export default function Home() {
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [secretInput, setSecretInput] = useState("");
  const [authError, setAuthError] = useState("");

  const fetchAlbums = async () => {
    setLoading(true);
    setAuthError("");
    try {
      const res = await authFetch("/api/albums");
      if (res.status === 401) {
        setShowAuthModal(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setAlbums(data);
      setShowAuthModal(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlbums();
  }, []);

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!secretInput.trim()) return;
    setAppSecret(secretInput.trim());
    fetchAlbums();
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
    alert("Share link copied to clipboard!");
  };

  const deleteAlbum = async (albumId: string) => {
    if (!confirm("Are you sure you want to delete this entire album and ALL photos? This action cannot be undone.")) return;
    try {
      const res = await authFetch(`/api/albums/${albumId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      // Remove from state immediately
      setAlbums(prev => prev.filter(a => a.id !== albumId));
    } catch {
      alert("Failed to delete album.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)" }}>
      {/* Auth Modal Overlay */}
      {showAuthModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(26,18,8,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>
          <div className="card animate-fade-up" style={{ maxWidth: 400, width: "100%", padding: 40, textAlign: "center" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--warm-white)", border: "1px solid var(--sand)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
              <Lock size={24} color="var(--gold)" />
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--espresso)", marginBottom: 12 }}>
              Admin Access
            </h2>
            <p style={{ color: "var(--brown)", fontSize: 14, marginBottom: 24 }}>
              FotoHaven is now protected. Please enter your <code>APP_SECRET</code> to manage your albums.
            </p>
            <form onSubmit={handleAuthSubmit}>
              <input
                type="password"
                className="input"
                placeholder="Enter App Secret..."
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                autoFocus
                style={{ marginBottom: 16, textAlign: "center" }}
              />
              <button className="btn-primary" type="submit" style={{ width: "100%" }} disabled={loading}>
                {loading ? "Verifying..." : "Sign In"}
              </button>
            </form>
            <p style={{ marginTop: 16, fontSize: 11, color: "var(--taupe)" }}>
              Check your <code>.env.local</code> for the secret key.
            </p>
          </div>
        </div>
      )}

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
              <Image size={16} color="var(--cream)" />
            </div>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, color: "var(--espresso)", letterSpacing: "0.02em" }}>
              FotoHaven
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/health" className="btn-ghost" title="System Health">
              <ShieldCheck size={18} />
            </Link>
            <Link href="/albums/new" className="btn-primary" style={{ textDecoration: "none" }}>
              <Plus size={16} />
              New Album
            </Link>
          </div>
        </div>
      </header>

      {/* Hero section */}
      <section className="px-4 md:px-10 py-10 md:py-16" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: "0.15em", color: "var(--gold)", textTransform: "uppercase", marginBottom: 12 }}>
          Your Albums
        </p>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 48, fontWeight: 300, color: "var(--espresso)", lineHeight: 1.1, marginBottom: 8 }}>
          Photo Handoffs,
          <br />
          <em>beautifully organised.</em>
        </h1>
        <p style={{ color: "var(--brown)", fontSize: 15, maxWidth: 480, marginTop: 12 }}>
          Upload your selected photos by ceremony, generate a share link, and hand off to your photographer — no WhatsApp zips needed.
        </p>
      </section>

      {/* Albums grid */}
      <main className="px-4 md:px-10 pb-20" style={{ maxWidth: 1200, margin: "0 auto" }}>
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 20 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 200, borderRadius: 16 }} />
            ))}
          </div>
        ) : albums.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 20 }}>
            {albums.map((album, i) => (
              <div
                key={album.id}
                className="card animate-fade-up"
                style={{ padding: 28, animationDelay: `${i * 60}ms`, animationFillMode: "both", opacity: 0 }}
              >
                {/* Card header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--espresso)", marginBottom: 4 }}>
                      {album.title}
                    </h2>
                    <p style={{ fontSize: 13, color: "var(--brown)" }}>{album.clientName}</p>
                  </div>
                  <span className="tag">{album.totalPhotos} photos</span>
                </div>

                {/* Ceremonies */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
                  {album.ceremonies.map((c) => (
                    <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brown)", background: "var(--warm-white)", padding: "3px 10px", borderRadius: 100, border: "1px solid var(--sand)" }}>
                      <FolderOpen size={11} />
                      {c.name}
                      <span style={{ color: "var(--taupe)" }}>·{c.photoCount}</span>
                      {c.finalCount > 0 && <span style={{ color: "var(--gold)", fontWeight: 600 }}>({c.finalCount} finals)</span>}
                    </span>
                  ))}
                </div>

                {/* Expiry */}
                {album.expiresAt && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--taupe)", marginBottom: 16 }}>
                    <Clock size={12} />
                    Expires {new Date(album.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, paddingTop: 16, borderTop: "1px solid var(--sand)" }}>
                  <Link
                    href={`/albums/${album.id}`}
                    className="btn-ghost"
                    style={{ flex: 1, justifyContent: "center", textDecoration: "none", fontSize: 13 }}
                  >
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
                    onClick={() => deleteAlbum(album.id)}
                    className="btn-ghost"
                    style={{ padding: "0 12px", color: "var(--blush)" }}
                    title="Delete Album"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-4 py-16 md:py-20" style={{ textAlign: "center", opacity: 0, animation: "fadeUp 0.6s ease 0.2s forwards" }}>
      <div style={{ width: 80, height: 80, background: "var(--warm-white)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
        <Image size={32} color="var(--taupe)" />
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
