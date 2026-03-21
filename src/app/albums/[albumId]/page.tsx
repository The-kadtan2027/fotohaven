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
  originalUrl?: string;
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
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);

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

  // ── Upload helper: XHR with progress tracking + retry ──
  // Strict concurrency = 1: upload one file at a time to prevent OOM on 6 GB device.
  const xhrUploadWithProgress = (
    url: string,
    file: File,
    onProgress: (pct: number) => void,
    retries = 3
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      let attempt = 0;

      const tryUpload = () => {
        attempt++;
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);
        xhr.setRequestHeader("Content-Type", file.type);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(100);
            resolve();
          } else {
            reject(new Error(`Upload failed (HTTP ${xhr.status})`));
          }
        };

        xhr.onerror = () => {
          if (attempt < retries) {
            // Exponential backoff: 1s, 2s, 4s
            const delay = Math.pow(2, attempt - 1) * 1000;
            console.warn(`[Upload] Retry ${attempt}/${retries} after ${delay}ms`);
            setTimeout(tryUpload, delay);
          } else {
            reject(new Error(`Upload failed after ${retries} retries`));
          }
        };

        xhr.send(file);
      };

      tryUpload();
    });
  };

  const uploadAll = async () => {
    const pending = uploads.filter((u) => u.status === "pending");
    if (!pending.length) return;
    setIsUploading(true);

    // Strict sequential: one file at a time (concurrency = 1)
    for (const item of pending) {
      const idx = uploads.findIndex((u) => u.file === item.file && u.ceremonyId === item.ceremonyId);

      setUploads((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], status: "uploading", progress: 0 };
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

        // Step 2: Upload via XHR with real progress + retry
        await xhrUploadWithProgress(
          uploadUrl,
          item.file,
          (pct) => {
            setUploads((prev) => {
              const next = [...prev];
              next[idx] = { ...next[idx], progress: pct };
              return next;
            });
          }
        );

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
          const res = await fetch(photo.originalUrl || photo.url);
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

  const deleteAlbum = async () => {
    if (!album) return;
    if (!confirm("Are you sure you want to delete this entire album and ALL photos? This action cannot be undone.")) return;
    try {
      const res = await fetch(`/api/albums/${album.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      window.location.href = "/";
    } catch {
      alert("Failed to delete album.");
    }
  };

  const deletePhoto = async (photoId: string) => {
    if (!confirm("Are you sure you want to delete this photo forever?")) return;
    try {
      const res = await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await fetchAlbum();
    } catch {
      alert("Failed to delete photo.");
    }
  };

  const togglePhotoSelection = (id: string, selected: boolean) => {
    if (selected) {
      setSelectedPhotos(prev => [...prev, id]);
    } else {
      setSelectedPhotos(prev => prev.filter(p => p !== id));
    }
  };

  const clearSelection = () => setSelectedPhotos([]);

  const deleteSelectedPhotos = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedPhotos.length} photo(s)?`)) return;
    setIsDeletingBatch(true);
    try {
      const res = await fetch("/api/photos/delete-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: selectedPhotos })
      });
      if (!res.ok) throw new Error();
      await fetchAlbum();
      clearSelection();
    } catch {
      alert("Failed to delete photos.");
    } finally {
      setIsDeletingBatch(false);
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
        className="glass px-4 md:px-8"
        style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid var(--sand)" }}
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
            <button
              className="btn-ghost"
              onClick={deleteAlbum}
              style={{ textDecoration: "none", fontSize: 13, color: "var(--blush)" }}
              title="Delete Album"
            >
              <Trash2 size={14} />
              Delete Album
            </button>
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

      <div className="flex flex-col md:flex-row" style={{ maxWidth: 1400, margin: "0 auto", minHeight: "calc(100vh - 64px)" }}>
        {/* Sidebar — ceremony list */}
        <aside className="w-full md:w-[240px] border-b md:border-b-0 md:border-r border-[var(--sand)] py-4 md:py-7 flex-shrink-0 overflow-x-auto whitespace-nowrap">
          <div className="px-4 md:px-5 mb-0 md:mb-5 inline-block md:block align-middle">
            <p className="hidden md:block" style={{ fontSize: 11, color: "var(--taupe)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>
              Ceremonies
            </p>
            <p className="hidden md:block" style={{ fontSize: 12, color: "var(--brown)" }}>{totalPhotos} photos total</p>
          </div>

          <div className="inline-flex md:block items-center gap-2 px-4 md:px-0 py-2 md:py-0">
          {album.ceremonies.map((c) => {
            const origCount = c.photos.filter((p) => !p.isReturn).length;
            const finCount = c.photos.filter((p) => p.isReturn).length;
            return (
              <button
                key={c.id}
                onClick={() => setActiveCeremony(c.id)}
                className="flex items-center gap-3 md:justify-between px-4 md:px-5 py-2 md:py-2.5 rounded-full md:rounded-none transition-all text-left border md:border-0 md:border-l-[3px]"
                style={{
                  background: activeCeremony === c.id ? "var(--warm-white)" : "transparent",
                  borderColor: activeCeremony === c.id ? "var(--gold)" : "var(--sand)",
                  cursor: "pointer",
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
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 md:p-8 overflow-auto">
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
                  or <span style={{ color: "var(--gold)", textDecoration: "underline" }}>browse files</span> · JPG, PNG, WebP, HEIC up to 25MB
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
                      <div key={i} style={{ background: "var(--warm-white)", borderRadius: 8, overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px" }}>
                          <StatusIcon status={u.status} />
                          <span style={{ flex: 1, fontSize: 13, color: "var(--espresso)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {u.file.name}
                          </span>
                          {u.status === "uploading" && (
                            <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600, minWidth: 36, textAlign: "right" }}>
                              {u.progress}%
                            </span>
                          )}
                          <span style={{ fontSize: 11, color: "var(--taupe)" }}>
                            {(u.file.size / 1024 / 1024).toFixed(1)} MB
                          </span>
                          {u.status !== "uploading" && (
                            <button onClick={() => clearUpload(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--taupe)", display: "flex" }}>
                              <X size={12} />
                            </button>
                          )}
                        </div>
                        {u.status === "uploading" && (
                          <div style={{ height: 3, background: "var(--sand)", borderRadius: "0 0 8px 8px" }}>
                            <div style={{ height: "100%", width: `${u.progress}%`, background: "var(--gold)", borderRadius: "0 0 8px 8px", transition: "width 0.3s ease" }} />
                          </div>
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
                    <PhotoCard 
                      key={photo.id} 
                      photo={photo} 
                      onDelete={deletePhoto} 
                      onSelect={togglePhotoSelection}
                      isSelected={selectedPhotos.includes(photo.id)}
                      showCheckbox={selectedPhotos.length > 0}
                    />
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

      {/* Selection Action Bar */}
      {selectedPhotos.length > 0 && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          background: "var(--espresso)", color: "#fff", padding: "12px 24px",
          borderRadius: 100, display: "flex", alignItems: "center", gap: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)", zIndex: 100
        }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {selectedPhotos.length} photo{selectedPhotos.length === 1 ? "" : "s"} selected
          </span>
          <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.2)" }} />
          <button onClick={clearSelection} style={{ background: "none", border: "none", color: "var(--sand)", cursor: "pointer", fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={deleteSelectedPhotos} disabled={isDeletingBatch} style={{ background: "var(--blush)", border: "none", color: "#fff", borderRadius: 100, padding: "6px 16px", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            {isDeletingBatch ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={14} />}
            Delete
          </button>
        </div>
      )}

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

function PhotoCard({ photo, onDelete, onSelect, isSelected, showCheckbox }: { photo: Photo, onDelete?: (id: string) => void, onSelect?: (id: string, selected: boolean) => void, isSelected?: boolean, showCheckbox?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if ((showCheckbox || hovered) && onSelect) {
          onSelect(photo.id, !isSelected);
        }
      }}
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
      {(showCheckbox || hovered || isSelected) && onSelect && (
        <div 
          onClick={(e) => {
            e.stopPropagation();
            onSelect(photo.id, !isSelected);
          }}
          style={{
            position: "absolute", top: 8, left: 8, zIndex: 10,
            width: 20, height: 20, borderRadius: 4,
            background: isSelected ? "var(--gold)" : "rgba(255,255,255,0.8)",
            border: isSelected ? "none" : "2px solid var(--taupe)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", opacity: (!isSelected && !hovered && showCheckbox) ? 0.5 : 1
          }}
        >
          {isSelected && <Check size={14} color="#fff" strokeWidth={3} />}
        </div>
      )}
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
        <p style={{ fontSize: 11, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: onDelete ? 24 : 0 }}>
          {photo.originalName}
        </p>
        {onDelete && (
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(photo.id); }}
            style={{ position: "absolute", bottom: 6, right: 6, background: "var(--blush)", border: "none", color: "#fff", borderRadius: 4, padding: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            title="Delete Photo"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
