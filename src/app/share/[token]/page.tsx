"use client";
// src/app/share/[token]/page.tsx
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useDropzone } from "react-dropzone";
import {
  Download, FolderOpen, Image as ImageIcon,
  Loader2, X, ZoomIn, ChevronLeft, ChevronRight, Check,
  MessageSquare, Send, Upload, PackageCheck,
} from "lucide-react";
import { Comment } from "@/types";

interface Photo {
  id: string;
  originalName: string;
  size: number;
  url: string;
  originalUrl?: string;
  storageKey: string;
  mimeType: string;
  comments?: any[];
  isReturn?: boolean;
  returnOf?: string | null;
  isSelected?: boolean;
}

type ReturnUploadStatus = "pending" | "uploading" | "done" | "error";
interface ReturnUploadItem {
  file: File;
  ceremonyId: string;
  status: ReturnUploadStatus;
  progress: number;
  error?: string;
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
  const [galleryTab, setGalleryTab] = useState<"originals" | "finals">("originals");
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [returnUploads, setReturnUploads] = useState<ReturnUploadItem[]>([]);
  const [isReturning, setIsReturning] = useState(false);
  const [lightboxFullLoaded, setLightboxFullLoaded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const fetchAlbum = async (providedPassword?: string) => {
    setLoading(true);
    setAuthError("");
    const headers: Record<string, string> = {};
    if (providedPassword) {
      headers["Authorization"] = `Bearer ${providedPassword}`;
    }

    try {
      const resp = await fetch(`/api/share/${token}`, { headers });
      const data = await resp.json();

      if (resp.status === 401 && data.passwordRequired) {
        setPasswordRequired(true);
        setLoading(false);
        return;
      }

      if (!resp.ok) {
        throw new Error(data.error || "Failed to load album");
      }

      setAlbum(data);
      setActiveCeremony(data.ceremonies[0]?.id ?? null);
      setPasswordRequired(false);
      // Pre-populate from persisted DB selections
      const preSelected = new Set<string>();
      for (const ceremony of data.ceremonies ?? []) {
        for (const photo of ceremony.photos ?? []) {
          if (photo.isSelected) preSelected.add(photo.id);
        }
      }
      setSelectedPhotos(preSelected);
    } catch (err: any) {
      setError(err.message || "This link is invalid or has expired.");
      if (providedPassword) setAuthError("Incorrect password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlbum();
  }, [token]);

  const toggleSelect = (photoId: string) => {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      const nowSelected = !next.has(photoId);
      if (nowSelected) next.add(photoId);
      else next.delete(photoId);
      // Persist to DB (fire-and-forget, optimistic)
      fetch(`/api/photos/${photoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSelected: nowSelected }),
      }).catch((err) => console.error('[toggleSelect] PATCH failed:', err));
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

  // Trigger download via native browser form submission (streaming)
  const requestDownload = (photoIds: string[], bundleName: string) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `/api/share/${token}/download`;
    
    const inputIds = document.createElement("input");
    inputIds.type = "hidden";
    inputIds.name = "photoIds";
    inputIds.value = JSON.stringify(photoIds);
    form.appendChild(inputIds);

    const inputName = document.createElement("input");
    inputName.type = "hidden";
    inputName.name = "bundleName";
    inputName.value = bundleName;
    form.appendChild(inputName);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  };

  const downloadPhoto = (photo: Photo) => {
    const link = document.createElement("a");
    link.href = photo.originalUrl || photo.url;
    link.download = photo.originalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadCeremony = (ceremony: Ceremony) => {
    const photoIds = ceremony.photos.map(p => p.id);
    requestDownload(photoIds, ceremony.name);
  };

  const downloadSelected = () => {
    if (!album || selectedPhotos.size === 0) return;
    const photoIds = Array.from(selectedPhotos);
    requestDownload(photoIds, `${album.title} — Selected Photos`);
  };

  const downloadAll = () => {
    if (!album) return;
    const photoIds = album.ceremonies.flatMap(c => c.photos.map(p => p.id));
    requestDownload(photoIds, `${album.title} — All Photos`);
  };

  // --- Upload Returns ---
  const onReturnDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!activeCeremony) return;
      const items: ReturnUploadItem[] = acceptedFiles.map((file) => ({
        file,
        ceremonyId: activeCeremony,
        status: "pending",
        progress: 0,
      }));
      setReturnUploads((prev) => [...prev, ...items]);
    },
    [activeCeremony]
  );

  const { getRootProps: getReturnRootProps, getInputProps: getReturnInputProps, isDragActive: isReturnDragActive } =
    useDropzone({
      onDrop: onReturnDrop,
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

  const uploadReturns = async () => {
    const pending = returnUploads.filter((u) => u.status === "pending");
    if (!pending.length) return;
    setIsReturning(true);

    // Strict sequential: one file at a time (concurrency = 1)
    for (const item of pending) {
      const idx = returnUploads.findIndex((u) => u.file === item.file && u.ceremonyId === item.ceremonyId);

      setReturnUploads((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], status: "uploading", progress: 0 };
        return next;
      });

      try {
        const metaRes = await fetch(`/api/share/${token}/upload`, {
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

        // Upload via XHR with real progress + retry
        await xhrUploadWithProgress(
          uploadUrl,
          item.file,
          (pct) => {
            setReturnUploads((prev) => {
              const next = [...prev];
              next[idx] = { ...next[idx], progress: pct };
              return next;
            });
          }
        );

        setReturnUploads((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], status: "done", progress: 100 };
          return next;
        });
      } catch (err) {
        setReturnUploads((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], status: "error", error: String(err) };
          return next;
        });
      }
    }

    setIsReturning(false);
    await fetchAlbum();
    setGalleryTab("finals");
    setTimeout(() => setReturnUploads((prev) => prev.filter((u) => u.status !== "done")), 2000);
  };

  const downloadFinals = () => {
    if (!album) return;
    const photoIds = album.ceremonies.flatMap(c => c.photos.filter(p => p.isReturn).map(p => p.id));
    if (photoIds.length === 0) return;
    requestDownload(photoIds, `${album.title} — Delivered Finals`);
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

  useEffect(() => {
    setLightboxFullLoaded(false);
  }, [lightbox?.index, lightbox?.photos]);

  useEffect(() => {
    setCommentsOpen(false);
  }, [lightbox?.index, lightbox?.photos]);

  // Fetch comments when lightbox photo changes
  useEffect(() => {
    if (!lightbox) {
      setComments([]);
      return;
    }
    const photoId = lightbox.photos[lightbox.index].id;
    fetch(`/api/comments?photoId=${photoId}`)
      .then(r => r.json())
      .then(setComments)
      .catch(console.error);
  }, [lightbox?.index, !!lightbox]);

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !lightbox || isSubmitting) return;

    const photoId = lightbox.photos[lightbox.index].id;
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        body: JSON.stringify({
          photoId,
          body: newComment,
          author: "client", // defaulting to client for share page
        }),
      });
      if (res.ok) {
        const added = await res.json();
        setComments(prev => [added, ...prev]);
        setNewComment("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

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

  if (passwordRequired) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cream)", padding: 32 }}>
        <div className="card" style={{ maxWidth: 400, width: "100%", padding: 32, textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--warm-white)", border: "1px solid var(--sand)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
            <FolderOpen size={24} color="var(--gold)" />
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--espresso)", marginBottom: 12 }}>
            Protected Album
          </h2>
          <p style={{ color: "var(--brown)", fontSize: 14, marginBottom: 24 }}>
            This album is password protected. Please enter the password to view.
          </p>
          <form onSubmit={(e) => { e.preventDefault(); fetchAlbum(password); }}>
            <input
              type="password"
              className="input"
              placeholder="Enter password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              style={{ marginBottom: 12, textAlign: "center" }}
            />
            {authError && <p style={{ color: "var(--blush)", fontSize: 12, marginBottom: 12 }}>{authError}</p>}
            <button className="btn-gold" type="submit" style={{ width: "100%" }} disabled={loading}>
              {loading ? "Verifying..." : "View Album"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (error && !passwordRequired) {
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
  const totalPhotos = album.ceremonies.reduce((s, c) => s + c.photos.filter((p) => !p.isReturn).length, 0);
  const totalFinals = album.ceremonies.reduce((s, c) => s + c.photos.filter((p) => p.isReturn).length, 0);
  const allPhotos = album.ceremonies.flatMap((c) => c.photos);
  const activeCeremonyOriginals = activeCeremonyData?.photos.filter((p) => !p.isReturn) ?? [];
  const activeCeremonyFinals = activeCeremonyData?.photos.filter((p) => p.isReturn) ?? [];
  const activeTabPhotos = galleryTab === "originals" ? activeCeremonyOriginals : activeCeremonyFinals;

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)" }}>

      {/* ── Hero header ── */}
      <div className="bg-[var(--espresso)] relative overflow-hidden px-4 md:px-10 py-10 md:py-14">
        {/* subtle texture overlay */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 20% 50%, rgba(201,150,58,0.15) 0%, transparent 60%), radial-gradient(circle at 80% 20%, rgba(201,150,58,0.08) 0%, transparent 50%)", pointerEvents: "none" }} />

        <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>
          <p style={{ fontSize: 12, color: "var(--gold)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 10 }}>
            Photo Album
          </p>
          <h1 className="text-4xl md:text-5xl" style={{ fontFamily: "var(--font-display)", fontWeight: 300, color: "#faf7f2", marginBottom: 6, lineHeight: 1.1 }}>
            {album.title}
          </h1>
          <p style={{ color: "rgba(250,247,242,0.65)", fontSize: 15, marginBottom: 32 }}>
            Shared by {album.clientName} · {totalPhotos} photos · {totalFinals > 0 ? `${totalFinals} finals · ` : ""}{album.ceremonies.length} ceremonies
            {selectedPhotos.size > 0 && (
              <span style={{ color: 'var(--gold)', marginLeft: 8 }}>
                · ★ Selected: {selectedPhotos.size}
              </span>
            )}
          </p>

          {/* Download actions */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {selectedPhotos.size > 0 ? (
              <button
                className="btn-gold"
                onClick={downloadSelected}
                style={{ fontSize: 13 }}
              >
                <><Download size={14} /> Download Selected ({selectedPhotos.size})</>
              </button>
            ) : null}
            <button
              onClick={downloadAll}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "10px 20px", background: "rgba(250,247,242,0.12)",
                color: "var(--cream)", border: "1px solid rgba(250,247,242,0.2)",
                borderRadius: 8, fontSize: 13, cursor: "pointer", transition: "all 0.2s",
                fontFamily: "var(--font-body)",
              }}
              >
                <><Download size={14} /> Download All Photos</>
              </button>
            {totalFinals > 0 && (
              <button
                onClick={downloadFinals}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "10px 20px", background: "rgba(201,150,58,0.25)",
                  color: "var(--gold)", border: "1px solid rgba(201,150,58,0.4)",
                  borderRadius: 8, fontSize: 13, cursor: "pointer", transition: "all 0.2s",
                  fontFamily: "var(--font-body)",
                }}
              >
                <><PackageCheck size={14} /> Download Finals ({totalFinals})</>
              </button>
            )}
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
      <div className="flex flex-col md:flex-row px-4 md:px-10" style={{ maxWidth: 1200, margin: "0 auto", gap: 0 }}>

        {/* Sidebar */}
        <aside className="w-full md:w-[220px] flex-shrink-0 pt-6 md:pt-8 pr-0 md:pr-6 pb-4 md:pb-0 border-b md:border-b-0 border-[var(--sand)] overflow-x-auto whitespace-nowrap">
          <p className="hidden md:block" style={{ fontSize: 11, color: "var(--taupe)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
            Ceremonies
          </p>
          <div className="inline-flex md:block items-center gap-2">
          {album.ceremonies.map((c) => {
            const origCount = c.photos.filter((p) => !p.isReturn).length;
            const finCount = c.photos.filter((p) => p.isReturn).length;
            return (
              <button
                key={c.id}
                onClick={() => setActiveCeremony(c.id)}
                className="flex items-center gap-3 md:justify-between px-4 md:px-3 py-2 md:py-2.5 rounded-full md:rounded-lg transition-all text-left border md:border-0 md:border-l-[3px]"
                style={{
                  background: activeCeremony === c.id ? "var(--warm-white)" : "transparent",
                  borderColor: activeCeremony === c.id ? "var(--gold)" : "var(--sand)",
                  marginBottom: 2,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: activeCeremony === c.id ? "var(--espresso)" : "var(--brown)", fontWeight: activeCeremony === c.id ? 500 : 400 }}>
                  <FolderOpen size={13} />
                  {c.name}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {finCount > 0 && (
                    <span style={{ fontSize: 9, background: "rgba(201,150,58,0.2)", color: "var(--gold)", padding: "1px 5px", borderRadius: 100, fontWeight: 600 }}>FINALS</span>
                  )}
                  <span style={{ fontSize: 11, color: "var(--taupe)" }}>{origCount}</span>
                </div>
              </button>
            );
          })}
          </div>
        </aside>

        {/* Gallery */}
        <main className="flex-1 pt-6 md:pt-8 pb-20">
          {activeCeremonyData && (
            <>
              {/* Ceremony header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--espresso)", marginBottom: 2 }}>
                    {activeCeremonyData.name}
                  </h2>
                  <p style={{ fontSize: 13, color: "var(--brown)" }}>
                    {activeCeremonyOriginals.length} original{activeCeremonyOriginals.length !== 1 ? "s" : ""}{activeCeremonyFinals.length > 0 ? ` · ${activeCeremonyFinals.length} finals` : ""}
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
                    style={{ fontSize: 12 }}
                  >
                    <><Download size={12} /> Download Ceremony</>
                  </button>
                </div>
              </div>

              {/* Originals / Finals tab switcher */}
              {activeCeremonyFinals.length > 0 && (
                <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--warm-white)", padding: 4, borderRadius: 10, width: "fit-content", border: "1px solid var(--sand)" }}>
                  {(["originals", "finals"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setGalleryTab(tab)}
                      style={{
                        padding: "7px 16px", fontSize: 12, fontWeight: 500, borderRadius: 7, border: "none",
                        cursor: "pointer", transition: "all 0.15s",
                        background: galleryTab === tab ? (tab === "finals" ? "var(--gold)" : "var(--espresso)") : "transparent",
                        color: galleryTab === tab ? "#fff" : "var(--taupe)",
                        display: "flex", alignItems: "center", gap: 6,
                      }}
                    >
                      {tab === "finals" ? <PackageCheck size={12} /> : <ImageIcon size={12} />}
                      {tab === "originals" ? `Originals (${activeCeremonyOriginals.length})` : `Delivered Finals (${activeCeremonyFinals.length})`}
                    </button>
                  ))}
                </div>
              )}

              {activeTabPhotos.length === 0 ? (
                <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--taupe)" }}>
                  <ImageIcon size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
                  <p style={{ fontSize: 14 }}>
                    {galleryTab === "finals" ? "No finals delivered yet." : "No photos in this ceremony yet."}
                  </p>
                </div>
              ) : (
                <div className="photo-grid">
                  {activeTabPhotos.map((photo, idx) => (
                    <GalleryPhoto
                      key={photo.id}
                      photo={photo}
                      selected={selectedPhotos.has(photo.id)}
                      onSelect={() => toggleSelect(photo.id)}
                      onZoom={() => setLightbox({ photos: activeTabPhotos, index: idx })}
                    />
                  ))}
                </div>
              )}

              {/* ── Upload Returns (Photographer dropzone) ── */}
              <div style={{ marginTop: 56, borderTop: "1px dashed var(--sand)", paddingTop: 40 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <PackageCheck size={18} color="var(--gold)" />
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--espresso)" }}>Upload Returns</h3>
                </div>
                <p style={{ fontSize: 13, color: "var(--brown)", marginBottom: 20 }}>
                  Photographer: drop edited finals here to deliver them back to the client.
                </p>

                <div
                  {...getReturnRootProps()}
                  style={{
                    border: `2px dashed ${isReturnDragActive ? "var(--gold)" : "var(--sand)"}`,
                    borderRadius: 16, padding: "28px 24px", textAlign: "center",
                    background: isReturnDragActive ? "rgba(201,150,58,0.04)" : "var(--warm-white)",
                    cursor: "pointer", transition: "all 0.2s ease", marginBottom: 16,
                  }}
                >
                  <input {...getReturnInputProps()} />
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: isReturnDragActive ? "var(--gold)" : "var(--sand)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                    <Upload size={18} color={isReturnDragActive ? "#fff" : "var(--brown)"} />
                  </div>
                  <p style={{ fontSize: 14, color: "var(--espresso)", fontWeight: 500, marginBottom: 4 }}>
                    {isReturnDragActive ? "Drop finals here" : "Drag & drop edited finals"}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--brown)" }}>
                    or <span style={{ color: "var(--gold)", textDecoration: "underline" }}>browse files</span> · JPG, PNG, WebP, HEIC up to 25MB
                  </p>
                </div>

                {returnUploads.length > 0 && (
                  <div className="card" style={{ padding: 16, marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: "var(--espresso)" }}>
                        Queue ({returnUploads.filter((u) => u.status === "pending").length} pending)
                      </p>
                      <button
                        className="btn-gold"
                        onClick={uploadReturns}
                        disabled={isReturning || returnUploads.every((u) => u.status !== "pending")}
                        style={{ fontSize: 12, padding: "8px 16px" }}
                      >
                        {isReturning
                          ? <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Uploading…</>
                          : <><Upload size={12} /> Upload All</>}
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {returnUploads.map((u, i) => (
                        <div key={i} style={{ background: "var(--warm-white)", borderRadius: 8, overflow: "hidden" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px" }}>
                            {u.status === "uploading" && <Loader2 size={13} color="var(--gold)" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />}
                            {u.status === "done" && <Check size={13} color="var(--sage)" style={{ flexShrink: 0 }} />}
                            {u.status === "error" && <X size={13} color="var(--blush)" style={{ flexShrink: 0 }} />}
                            {u.status === "pending" && <div style={{ width: 13, height: 13, borderRadius: "50%", border: "1.5px solid var(--taupe)", flexShrink: 0 }} />}
                            <span style={{ flex: 1, fontSize: 13, color: "var(--espresso)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.file.name}</span>
                            {u.status === "uploading" && (
                              <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600, minWidth: 36, textAlign: "right" }}>
                                {u.progress}%
                              </span>
                            )}
                            <span style={{ fontSize: 11, color: "var(--taupe)" }}>{(u.file.size / 1024 / 1024).toFixed(1)} MB</span>
                            {u.status !== "uploading" && (
                              <button
                                onClick={() => setReturnUploads((prev) => prev.filter((_, j) => j !== i))}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--taupe)", display: "flex" }}
                              >
                                <X size={11} />
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
              </div>
            </>
          )}
        </main>
      </div>

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(26,18,8,0.95)", zIndex: 1000, display: "flex" }}
          onClick={() => setLightbox(null)}
        >
          {/* Main Content Area (Image + Nav) */}
          <div 
            style={{ 
              flex: 1, 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              position: "relative",
              padding: "40px"
            }}
          >
            <div style={{ position: "absolute", top: 20, right: 20, display: "flex", gap: 8, zIndex: 10 }}>
              <button
                onClick={(e) => { e.stopPropagation(); downloadPhoto(lightbox.photos[lightbox.index]); }}
                style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 999, minWidth: 40, height: 40, padding: "0 14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", gap: 8 }}
              >
                <Download size={16} />
                <span style={{ fontSize: 12 }}>Download</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setCommentsOpen((prev) => !prev); }}
                style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 999, minWidth: 40, height: 40, padding: "0 14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", gap: 8 }}
              >
                <MessageSquare size={16} />
                <span style={{ fontSize: 12 }}>{commentsOpen ? "Hide Notes" : "Show Notes"}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
                style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}
              >
                <X size={18} />
              </button>
            </div>

            {lightbox.index > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setLightbox((lb) => lb && { ...lb, index: lb.index - 1 }); }}
                style={{ position: "absolute", left: 20, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 10 }}
              >
                <ChevronLeft size={20} />
              </button>
            )}

            <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
              <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: "100%", minHeight: "70vh" }}>
                <img
                  src={lightbox.photos[lightbox.index].url}
                  alt={lightbox.photos[lightbox.index].originalName}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    maxWidth: "100%",
                    maxHeight: "85vh",
                    objectFit: "contain",
                    borderRadius: 8,
                    filter: "blur(18px)",
                    transform: "scale(1.02)",
                    opacity: lightboxFullLoaded ? 0 : 0.85,
                    transition: "opacity 0.25s ease",
                  }}
                />
                <img
                  src={lightbox.photos[lightbox.index].originalUrl || lightbox.photos[lightbox.index].url}
                  alt={lightbox.photos[lightbox.index].originalName}
                  onClick={(e) => e.stopPropagation()}
                  onLoad={() => setLightboxFullLoaded(true)}
                  style={{ 
                    position: "relative",
                    maxWidth: "100%", 
                    maxHeight: "85vh", 
                    objectFit: "contain", 
                    borderRadius: 8, 
                    boxShadow: "0 20px 80px rgba(0,0,0,0.6)",
                    opacity: lightboxFullLoaded ? 1 : 0,
                    transition: "opacity 0.35s ease",
                  }}
                />
              </div>
              <div style={{ marginTop: 16, color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
                {lightbox.index + 1} / {lightbox.photos.length} · {lightbox.photos[lightbox.index].originalName}
              </div>
            </div>

            {lightbox.index < lightbox.photos.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); setLightbox((lb) => lb && { ...lb, index: lb.index + 1 }); }}
                style={{ position: "absolute", right: 20, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 10 }}
              >
                <ChevronRight size={20} />
              </button>
            )}
          </div>

          {/* Comments Sidebar */}
          {commentsOpen && (
          <div 
            style={{ 
              width: "min(350px, 85vw)", 
              background: "var(--espresso)", 
              borderLeft: "1px solid rgba(255,255,255,0.1)",
              display: "flex", 
              flexDirection: "column",
              position: "relative"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "24px 20px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              <h3 style={{ fontFamily: "var(--font-display)", color: "var(--warm-white)", fontSize: 18, display: "flex", alignItems: "center", gap: 10 }}>
                <MessageSquare size={18} color="var(--gold)" />
                Photo Notes
              </h3>
            </div>

            {/* Comments List */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
              {comments.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.3)" }}>
                  <p style={{ fontSize: 13 }}>No notes yet.</p>
                </div>
              ) : (
                comments.map((c) => (
                  <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--gold)", textTransform: "uppercase" }}>
                        {c.author}
                      </span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                        {new Date(c.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", lineHeight: 1.5, background: "rgba(255,255,255,0.03)", padding: "10px 12px", borderRadius: 8 }}>
                      {c.body}
                    </p>
                  </div>
                ))
              )}
            </div>

            {/* Input area */}
            <form 
              onSubmit={submitComment}
              style={{ padding: 20, borderTop: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.2)" }}
            >
              <div style={{ position: "relative" }}>
                <textarea
                  placeholder="Leave a note..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  style={{ 
                    width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12, padding: "12px 40px 12px 14px", color: "#fff", fontSize: 13,
                    resize: "none", height: 80, fontFamily: "inherit"
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitComment(e as any);
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={!newComment.trim() || isSubmitting}
                  style={{ 
                    position: "absolute", right: 10, bottom: 10, 
                    background: "transparent", border: "none", color: "var(--gold)",
                    cursor: "pointer", padding: 8, opacity: newComment.trim() ? 1 : 0.3
                  }}
                >
                  <Send size={18} />
                </button>
              </div>
            </form>
          </div>
          )}
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

      {photo.comments && photo.comments.length > 0 && (
        <div 
          style={{ 
            position: "absolute", bottom: 12, left: 12, 
            width: 8, height: 8, borderRadius: "50%", 
            background: "var(--gold)", border: "1.5px solid #fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            zIndex: 5
          }} 
        />
      )}

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
