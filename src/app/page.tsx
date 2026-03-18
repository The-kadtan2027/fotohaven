"use client";
// src/app/page.tsx
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Image, Share2, Clock, FolderOpen, Trash2 } from "lucide-react";

interface AlbumSummary {
  id: string;
  title: string;
  clientName: string;
  shareToken: string;
  expiresAt: string | null;
  createdAt: string;
  totalPhotos: number;
  ceremonies: { id: string; name: string; photos: any[] }[];
}

export default function Home() {
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/albums")
      .then((r) => r.json())
      .then((data) => { setAlbums(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

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
      const res = await fetch(`/api/albums/${albumId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      // Remove from state immediately
      setAlbums(prev => prev.filter(a => a.id !== albumId));
    } catch {
      alert("Failed to delete album.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)" }}>
      {/* Header */}
      <header
        className="glass"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          borderBottom: "1px solid var(--sand)",
          padding: "0 40px",
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
          <Link href="/albums/new" className="btn-primary" style={{ textDecoration: "none" }}>
            <Plus size={16} />
            New Album
          </Link>
        </div>
      </header>

      {/* Hero section */}
      <section style={{ padding: "60px 40px 40px", maxWidth: 1200, margin: "0 auto" }}>
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
      <main style={{ padding: "0 40px 80px", maxWidth: 1200, margin: "0 auto" }}>
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 20 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 200, borderRadius: 16 }} />
            ))}
          </div>
        ) : albums.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
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
                      <span style={{ color: "var(--taupe)" }}>·{c.photos.length}</span>
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
    <div style={{ textAlign: "center", padding: "80px 20px", opacity: 0, animation: "fadeUp 0.6s ease 0.2s forwards" }}>
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
