"use client";
// src/app/share/[token]/page.tsx
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Download, FolderOpen, Image as ImageIcon,
  Loader2, X, ZoomIn, ChevronLeft, ChevronRight, Check
} from "lucide-react";

interface Photo {
  id: string;
  originalName: string;
  size: number;
  url: string;
  storageKey: string;
  mimeType: string;
}

interface Ceremony {
  id: string;
  name: string;
  order: number;
  photos: Photo[];
}

interface Album {
  id: string;
  title: string;
  clientName: string;
  shareToken: string;
  expiresAt: string | null;
  ceremonies: Ceremony[];
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeCeremony, setActiveCeremony] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null); // ceremonyId or "all"
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(d.error));
        return r.json();
      })
      .then((data: Album) => {
        setAlbum(data);
        setActiveCeremony(data.ceremonies[0]?.id ?? null);
        setLoading(false);
      })
      .catch((err) => {
        setError(typeof err === "string" ? err : "This link is invalid or has expired.");
        setLoading(false);
      });
  }, [token]);

  const toggleSelect = (photoId: string) => {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const selectAllInCeremony = (ceremony: Ceremony) => {
    const allIds = ceremony.photos.map((p) => p.id);
    const allSelected = allIds.every((id) => selectedPhotos.has(id));
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (allSelected) allIds.forEach((id) => next.delete(id));
      else allIds.forEach((id) => next.add(id));
      return next;
    });
  };

  // Download photos as individual files (fallback: open each in new tab)
  // In production: generate a signed ZIP via an API route
  const downloadCeremony = async (ceremony: Ceremony) => {
    setDownloading(ceremony.id);
    try {
      // Dynamic import JSZip only when needed
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folder = zip.folder(ceremony.name)!;

      await Promise.all(
        ceremony.photos.map(async (photo) => {
          const res = await fetch(photo.url);
          const blob = await res.blob();
          folder.file(photo.originalName, blob);
        })
      );

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ceremony.name}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed. Please try again.");
    } finally {
      setDownloading(null);
    }
  };

  const downloadSelected = async () => {
    if (!album || selectedPhotos.size === 0) return;
    setDownloading("selected");
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      for (const ceremony of album.ceremonies) {
        const photosToDownload = ceremony.photos.filter((p) => selectedPhotos.has(p.id));
        if (!photosToDownload.length) continue;
        const folder = zip.folder(ceremony.name)!;
        await Promise.all(
          photosToDownload.map(async (photo) => {
            const res = await fetch(photo.url);
            const blob = await res.blob();
            folder.file(photo.originalName, blob);
          })
        );
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${album.title} — Selected Photos.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed. Please try again.");
    } finally {
      setDownloading(null);
    }
  };

  const downloadAll = async () => {
    if (!album) return;
    setDownloading("all");
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      for (const ceremony of album.ceremonies) {
        const folder = zip.folder(ceremony.name)!;
        await Promise.all(
          ceremony.photos.map(async (photo) => {
            const res = await fetch(photo.url);
            const blob = await res.blob();
            folder.file(photo.originalName, blob);
          })
        );
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${album.title} — All Photos.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed. Please try again.");
    } finally {
      setDownloading(null);
    }
  };

  // Lightbox keyboard navigation
  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setLightbox((lb) => lb && { ...lb, index: Math.min(lb.index + 1, lb.photos.length - 1) });
      if (e.key === "ArrowLeft")  setLightbox((lb) => lb && { ...lb, index: Math.max(lb.index - 1, 0) });
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox]);

  // ---- Render states ----

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--cream)", gap: 16 }}>
        <Loader2 size={32} color="var(--taupe)" style={{ animation: "spin 1s linear infinite" }} />
        <p style={{ fontSize: 14, color: "var(--brown)" }}>Loading your album…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--cream)", padding: 32, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--warm-white)", border: "1px solid var(--sand)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
          <X size={24} color="var(--blush)" />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--espresso)", marginBottom: 8 }}>
          Link unavailable
        </h2>
        <p style={{ color: "var(--brown)", fontSize: 15 }}>{error}</p>
      </div>
    );
  }

  if (!album) return null;

  const activeCeremonyData = album.ceremonies.find((c) => c.id === activeCeremony);
  const totalPhotos = album.ceremonies.reduce((s, c) => s + c.photos.length, 0);
  const allPhotos = album.ceremonies.flatMap((c) => c.photos);

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)" }}>

      {/* ── Hero header ── */}
      <div style={{ background: "var(--espresso)", padding: "52px 40px 40px", position: "relative", overflow: "hidden" }}>
        {/* subtle texture overlay */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 20% 50%, rgba(201,150,58,0.15) 0%, transparent 60%), radial-gradient(circle at 80% 20%, rgba(201,150,58,0.08) 0%, transparent 50%)", pointerEvents: "none" }} />

        <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>
          <p style={{ fontSize: 12, color: "var(--gold)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 10 }}>
            Photo Album
          </p>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 52, fontWeight: 300, color: "#faf7f2", marginBottom: 6, lineHeight: 1.1 }}>
            {album.title}
          </h1>
          <p style={{ color: "rgba(250,247,242,0.55)", fontSize: 15, marginBottom: 32 }}>
            Shared by {album.clientName} · {totalPhotos} photos · {album.ceremonies.length} ceremonies
          </p>

          {/* Download actions */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {selectedPhotos.size > 0 ? (
              <button
                className="btn-gold"
                onClick={downloadSelected}
                disabled={downloading === "selected"}
                style={{ fontSize: 13 }}
              >
                {downloading === "selected"
                  ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Zipping…</>
                  : <><Download size={14} /> Download Selected ({selectedPhotos.size})</>}
              </button>
            ) : null}
            <button
              onClick={downloadAll}
              disabled={!!downloading}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "10px 20px", background: "rgba(250,247,242,0.12)",
                color: "var(--cream)", border: "1px solid rgba(250,247,242,0.2)",
                borderRadius: 8, fontSize: 13, cursor: "pointer", transition: "all 0.2s",
                fontFamily: "var(--font-body)",
              }}
            >
              {downloading === "all"
                ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Zipping all…</>
                : <><Download size={14} /> Download All Photos</>}
            </button>
            {selectedPhotos.size > 0 && (
              <button
                onClick={() => setSelectedPhotos(new Set())}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "transparent", color: "rgba(250,247,242,0.5)", border: "1px solid rgba(250,247,242,0.15)", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-body)" }}
              >
                <X size={13} /> Clear selection
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", gap: 0, padding: "0 40px" }}>

        {/* Sidebar */}
        <aside style={{ width: 220, flexShrink: 0, paddingTop: 32, paddingRight: 24 }}>
          <p style={{ fontSize: 11, color: "var(--taupe)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
            Ceremonies
          </p>
          {album.ceremonies.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCeremony(c.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 12px", background: activeCeremony === c.id ? "var(--warm-white)" : "transparent",
                border: "none", borderRadius: 8, cursor: "pointer", transition: "all 0.15s", marginBottom: 2,
                borderLeft: activeCeremony === c.id ? "3px solid var(--gold)" : "3px solid transparent",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: activeCeremony === c.id ? "var(--espresso)" : "var(--brown)", fontWeight: activeCeremony === c.id ? 500 : 400 }}>
                <FolderOpen size={13} />
                {c.name}
              </span>
              <span style={{ fontSize: 11, color: "var(--taupe)" }}>{c.photos.length}</span>
            </button>
          ))}
        </aside>

        {/* Gallery */}
        <main style={{ flex: 1, paddingTop: 32, paddingBottom: 80 }}>
          {activeCeremonyData && (
            <>
              {/* Ceremony header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--espresso)", marginBottom: 2 }}>
                    {activeCeremonyData.name}
                  </h2>
                  <p style={{ fontSize: 13, color: "var(--brown)" }}>
                    {activeCeremonyData.photos.length} photos
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn-ghost"
                    onClick={() => selectAllInCeremony(activeCeremonyData)}
                    style={{ fontSize: 12 }}
                  >
                    <Check size={13} />
                    {activeCeremonyData.photos.every((p) => selectedPhotos.has(p.id))
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => downloadCeremony(activeCeremonyData)}
                    disabled={downloading === activeCeremonyData.id}
                    style={{ fontSize: 12 }}
                  >
                    {downloading === activeCeremonyData.id
                      ? <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Zipping…</>
                      : <><Download size={12} /> Download Ceremony</>}
                  </button>
                </div>
              </div>

              {activeCeremonyData.photos.length === 0 ? (
                <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--taupe)" }}>
                  <ImageIcon size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
                  <p style={{ fontSize: 14 }}>No photos in this ceremony yet.</p>
                </div>
              ) : (
                <div className="photo-grid">
                  {activeCeremonyData.photos.map((photo, idx) => (
                    <GalleryPhoto
                      key={photo.id}
                      photo={photo}
                      selected={selectedPhotos.has(photo.id)}
                      onSelect={() => toggleSelect(photo.id)}
                      onZoom={() => setLightbox({ photos: activeCeremonyData.photos, index: idx })}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(26,18,8,0.95)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            style={{ position: "absolute", top: 20, right: 20, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}
          >
            <X size={18} />
          </button>

          {lightbox.index > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightbox((lb) => lb && { ...lb, index: lb.index - 1 }); }}
              style={{ position: "absolute", left: 20, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}
            >
              <ChevronLeft size={20} />
            </button>
          )}

          <img
            src={lightbox.photos[lightbox.index].url}
            alt={lightbox.photos[lightbox.index].originalName}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 20px 80px rgba(0,0,0,0.6)" }}
          />

          {lightbox.index < lightbox.photos.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightbox((lb) => lb && { ...lb, index: lb.index + 1 }); }}
              style={{ position: "absolute", right: 20, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}
            >
              <ChevronRight size={20} />
            </button>
          )}

          <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
            {lightbox.index + 1} / {lightbox.photos.length} · {lightbox.photos[lightbox.index].originalName}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function GalleryPhoto({
  photo, selected, onSelect, onZoom,
}: {
  photo: Photo;
  selected: boolean;
  onSelect: () => void;
  onZoom: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{ position: "relative", aspectRatio: "1", borderRadius: 10, overflow: "hidden", background: "var(--sand)", cursor: "pointer" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!loaded && <div className="skeleton" style={{ position: "absolute", inset: 0 }} />}
      <img
        src={photo.url}
        alt={photo.originalName}
        onLoad={() => setLoaded(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover", opacity: loaded ? 1 : 0, transition: "opacity 0.3s, transform 0.3s", transform: hovered ? "scale(1.03)" : "scale(1)" }}
      />

      {/* Overlay */}
      <div style={{ position: "absolute", inset: 0, background: selected ? "rgba(201,150,58,0.25)" : hovered ? "rgba(26,18,8,0.2)" : "transparent", transition: "background 0.2s", border: selected ? "2px solid var(--gold)" : "2px solid transparent", borderRadius: 10 }} />

      {/* Select checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        style={{
          position: "absolute", top: 8, left: 8,
          width: 22, height: 22, borderRadius: 6,
          background: selected ? "var(--gold)" : "rgba(250,247,242,0.85)",
          border: selected ? "none" : "1.5px solid rgba(26,18,8,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", opacity: selected || hovered ? 1 : 0,
          transition: "all 0.15s", boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }}
      >
        {selected && <Check size={12} color="#fff" />}
      </button>

      {/* Zoom button */}
      <button
        onClick={(e) => { e.stopPropagation(); onZoom(); }}
        style={{
          position: "absolute", top: 8, right: 8,
          width: 28, height: 28, borderRadius: 6,
          background: "rgba(250,247,242,0.85)", border: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", opacity: hovered ? 1 : 0, transition: "opacity 0.15s",
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }}
      >
        <ZoomIn size={13} color="var(--espresso)" />
      </button>
    </div>
  );
}
