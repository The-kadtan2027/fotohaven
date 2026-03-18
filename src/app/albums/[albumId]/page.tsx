"use client";
// src/app/albums/[albumId]/page.tsx
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDropzone } from "react-dropzone";
import {
  ArrowLeft, Share2, Upload, Check, X, Image as ImageIcon,
  FolderOpen, Loader2, Copy, ExternalLink, Trash2, PackageCheck,
} from "lucide-react";

interface Photo {
  id: string;
  originalName: string;
  size: number;
  url: string;
  storageKey: string;
  comments?: any[];
  isReturn?: boolean;
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

type UploadStatus = "pending" | "uploading" | "done" | "error";

interface UploadItem {
  file: File;
  ceremonyId: string;
  status: UploadStatus;
  progress: number;
  error?: string;
}

export default function AlbumPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCeremony, setActiveCeremony] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [downloadingFinals, setDownloadingFinals] = useState(false);

  useEffect(() => {
    fetchAlbum();
  }, [albumId]);

  const fetchAlbum = async () => {
    const res = await fetch(`/api/albums/${albumId}`);
    const data = await res.json();
    setAlbum(data);
    if (!activeCeremony && data.ceremonies?.[0]) {
      setActiveCeremony(data.ceremonies[0].id);
    }
    setLoading(false);
  };

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!activeCeremony) return;
      const items: UploadItem[] = acceptedFiles.map((file) => ({
        file,
        ceremonyId: activeCeremony,
        status: "pending",
        progress: 0,
      }));
      setUploads((prev) => [...prev, ...items]);
    },
    [activeCeremony]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp", ".heic"] },
    multiple: true,
  });

  const uploadAll = async () => {
    const pending = uploads.filter((u) => u.status === "pending");
    if (!pending.length) return;
    setIsUploading(true);

    for (const item of pending) {
      const idx = uploads.findIndex((u) => u.file === item.file && u.ceremonyId === item.ceremonyId);

      setUploads((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], status: "uploading" };
        return next;
      });

      try {
        // Step 1: Request presigned upload URL
        const metaRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ceremonyId: item.ceremonyId,
            filename: item.file.name,
            contentType: item.file.type,
            size: item.file.size,
          }),
        });
        if (!metaRes.ok) throw new Error("Failed to get upload URL");
        const { uploadUrl } = await metaRes.json();

        // Step 2: PUT directly to R2 (bypasses server bandwidth)
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          body: item.file,
          headers: { "Content-Type": item.file.type },
        });
        if (!uploadRes.ok) throw new Error("Upload to storage failed");

        setUploads((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], status: "done", progress: 100 };
          return next;
        });
      } catch (err) {
        setUploads((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], status: "error", error: String(err) };
          return next;
        });
      }
    }

    setIsUploading(false);
    // Refresh album to show new photos
    await fetchAlbum();
    // Clear done uploads after a delay
    setTimeout(() => setUploads((prev) => prev.filter((u) => u.status !== "done")), 2000);
  };

  const clearUpload = (idx: number) =>
    setUploads((prev) => prev.filter((_, i) => i !== idx));

  const copyShareLink = async () => {
    if (!album) return;
    const url = `${window.location.origin}/share/${album.shareToken}`;
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
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  };

  const downloadFinals = async (ceremony: Ceremony) => {
    const finals = ceremony.photos.filter((p) => p.isReturn);
    if (!finals.length) return;
    setDownloadingFinals(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folder = zip.folder(`${ceremony.name} — Finals`)!;
      await Promise.all(
        finals.map(async (photo) => {
          const res = await fetch(photo.url);
          const blob = await res.blob();
          folder.file(photo.originalName, blob);
        })
      );
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ceremony.name} — Finals.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed.");
    } finally {
      setDownloadingFinals(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cream)" }}>
        <Loader2 size={32} color="var(--taupe)" style={{ animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!album) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cream)" }}>
        <p>Album not found.</p>
      </div>
    );
  }

  const activeCeremonyData = album.ceremonies.find((c) => c.id === activeCeremony);
  const totalPhotos = album.ceremonies.reduce((sum, c) => sum + c.photos.length, 0);

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)" }}>
      {/* Header */}
      <header
        className="glass"
        style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid var(--sand)", padding: "0 32px" }}
      >
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Link href="/" className="btn-ghost" style={{ textDecoration: "none", padding: "8px 12px", fontSize: 13 }}>
              <ArrowLeft size={14} />
              Albums
            </Link>
            <div style={{ width: 1, height: 20, background: "var(--sand)" }} />
            <div>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--espresso)" }}>{album.title}</span>
              <span style={{ fontSize: 13, color: "var(--taupe)", marginLeft: 10 }}>{album.clientName}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link
              href={`/share/${album.shareToken}`}
              target="_blank"
              className="btn-ghost"
              style={{ textDecoration: "none", fontSize: 13 }}
            >
              <ExternalLink size={14} />
              Preview
            </Link>
            <button className="btn-gold" onClick={copyShareLink} style={{ fontSize: 13 }}>
              {linkCopied ? <Check size={14} /> : <Share2 size={14} />}
              {linkCopied ? "Copied!" : "Share Link"}
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", gap: 0, minHeight: "calc(100vh - 64px)" }}>
        {/* Sidebar — ceremony list */}
        <aside style={{ width: 240, borderRight: "1px solid var(--sand)", padding: "28px 0", flexShrink: 0 }}>
          <div style={{ padding: "0 20px", marginBottom: 20 }}>
            <p style={{ fontSize: 11, color: "var(--taupe)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
              Ceremonies
            </p>
            <p style={{ fontSize: 12, color: "var(--brown)" }}>{totalPhotos} photos total</p>
          </div>

          {album.ceremonies.map((c) => {
            const origCount = c.photos.filter((p) => !p.isReturn).length;
            const finCount = c.photos.filter((p) => p.isReturn).length;
            return (
              <button
                key={c.id}
                onClick={() => setActiveCeremony(c.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 20px",
                  background: activeCeremony === c.id ? "var(--warm-white)" : "transparent",
                  border: "none",
                  borderLeft: activeCeremony === c.id ? "3px solid var(--gold)" : "3px solid transparent",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  textAlign: "left",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: activeCeremony === c.id ? "var(--espresso)" : "var(--brown)", fontWeight: activeCeremony === c.id ? 500 : 400 }}>
                  <FolderOpen size={14} />
                  {c.name}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {finCount > 0 && (
                    <span title={`${finCount} finals`} style={{ fontSize: 9, background: "rgba(201,150,58,0.2)", color: "var(--gold)", padding: "1px 5px", borderRadius: 100, fontWeight: 600 }}>FINALS</span>
                  )}
                  <span style={{ fontSize: 11, color: "var(--taupe)", background: "var(--sand)", padding: "2px 7px", borderRadius: 100 }}>
                    {origCount}
                  </span>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, padding: 32, overflow: "auto" }}>
          {activeCeremonyData && (
            <>
              {/* Ceremony header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
                <div>
                  <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--espresso)" }}>
                    {activeCeremonyData.name}
                  </h2>
                  <p style={{ fontSize: 13, color: "var(--brown)", marginTop: 2 }}>
                    {activeCeremonyData.photos.filter((p) => !p.isReturn).length} photos uploaded
                    {activeCeremonyData.photos.filter((p) => p.isReturn).length > 0 && (
                      <span style={{ color: "var(--gold)", marginLeft: 8 }}>
                        · {activeCeremonyData.photos.filter((p) => p.isReturn).length} finals delivered
                      </span>
                    )}
                  </p>
                </div>
                {activeCeremonyData.photos.some((p) => p.isReturn) && (
                  <button
                    className="btn-gold"
                    onClick={() => downloadFinals(activeCeremonyData)}
                    disabled={downloadingFinals}
                    style={{ fontSize: 12 }}
                  >
                    {downloadingFinals
                      ? <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Zipping…</>
                      : <><PackageCheck size={12} /> Download Finals</>}
                  </button>
                )}
              </div>

              {/* Drop zone */}
              <div
                {...getRootProps()}
                style={{
                  border: `2px dashed ${isDragActive ? "var(--gold)" : "var(--sand)"}`,
                  borderRadius: 16,
                  padding: "32px 24px",
                  textAlign: "center",
                  background: isDragActive ? "rgba(201, 150, 58, 0.04)" : "var(--warm-white)",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  marginBottom: 24,
                }}
              >
                <input {...getInputProps()} />
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: isDragActive ? "var(--gold)" : "var(--sand)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <Upload size={20} color={isDragActive ? "#fff" : "var(--brown)"} />
                </div>
                <p style={{ fontSize: 15, color: "var(--espresso)", fontWeight: 500, marginBottom: 4 }}>
                  {isDragActive ? "Drop photos here" : "Drag & drop photos"}
                </p>
                <p style={{ fontSize: 13, color: "var(--brown)" }}>
                  or <span style={{ color: "var(--gold)", textDecoration: "underline" }}>browse files</span> · JPG, PNG, WebP, HEIC up to 50MB
                </p>
              </div>

              {/* Upload queue */}
              {uploads.length > 0 && (
                <div className="card" style={{ padding: 20, marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: "var(--espresso)" }}>
                      Upload Queue ({uploads.filter((u) => u.status === "pending").length} pending)
                    </p>
                    <button
                      className="btn-primary"
                      onClick={uploadAll}
                      disabled={isUploading || uploads.every((u) => u.status !== "pending")}
                      style={{ fontSize: 12, padding: "8px 16px" }}
                    >
                      {isUploading ? (
                        <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Uploading…</>
                      ) : (
                        <><Upload size={12} /> Upload All</>
                      )}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {uploads.map((u, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--warm-white)", borderRadius: 8 }}>
                        <StatusIcon status={u.status} />
                        <span style={{ flex: 1, fontSize: 13, color: "var(--espresso)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {u.file.name}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--taupe)" }}>
                          {(u.file.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        {u.status !== "uploading" && (
                          <button onClick={() => clearUpload(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--taupe)", display: "flex" }}>
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Photo grid */}
              {activeCeremonyData.photos.length > 0 ? (
                <div className="photo-grid">
                  {activeCeremonyData.photos.map((photo) => (
                    <PhotoCard key={photo.id} photo={photo} />
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--taupe)" }}>
                  <ImageIcon size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
                  <p style={{ fontSize: 14 }}>No photos yet. Drop some above to get started.</p>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function StatusIcon({ status }: { status: UploadStatus }) {
  if (status === "uploading") return <Loader2 size={14} color="var(--gold)" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />;
  if (status === "done") return <Check size={14} color="var(--sage)" style={{ flexShrink: 0 }} />;
  if (status === "error") return <X size={14} color="var(--blush)" style={{ flexShrink: 0 }} />;
  return <div style={{ width: 14, height: 14, borderRadius: "50%", border: "1.5px solid var(--taupe)", flexShrink: 0 }} />;
}

function PhotoCard({ photo }: { photo: Photo }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      style={{
        aspectRatio: "1",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--sand)",
        position: "relative",
        cursor: "pointer",
      }}
    >
      {!loaded && <div className="skeleton" style={{ position: "absolute", inset: 0 }} />}
      <img
        src={photo.url}
        alt={photo.originalName}
        onLoad={() => setLoaded(true)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />
      {photo.comments && photo.comments.length > 0 && (
        <div 
          title={`${photo.comments.length} note(s)`}
          style={{ 
            position: "absolute", top: 10, right: 10, 
            width: 10, height: 10, borderRadius: "50%", 
            background: "var(--gold)", border: "2px solid #fff",
            boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
            zIndex: 5
          }} 
        />
      )}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "24px 8px 8px", background: "linear-gradient(transparent, rgba(26,18,8,0.5))", opacity: 0, transition: "opacity 0.2s" }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
      >
        <p style={{ fontSize: 11, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {photo.originalName}
        </p>
      </div>
    </div>
  );
}
