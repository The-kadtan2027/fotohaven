"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDropzone } from "react-dropzone";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FolderOpen,
  Image as ImageIcon,
  Lock,
  Loader2,
  PackageCheck,
  Search,
  Settings2,
  Share2,
  Trash2,
  Upload,
  User,
  X,
  Activity,
  History,
  Download,
  Camera,
} from "lucide-react";
import FaceProcessor from "./FaceProcessor";
import AlbumLightbox, { type LightboxState } from "./AlbumLightbox";
import DuplicateModal from "./DuplicateModal";
import { buildDuplicateGroups, type AlbumPhoto } from "./album-utils";
import { compressImageFile, computeDHashFromUrl, type CompressionFormat } from "@/lib/image-utils";
import { useToast } from "@/components/ToastProvider";
import { FACE_CONFIG } from "@/lib/face-config";

interface Photo extends AlbumPhoto {
  size: number;
  storageKey: string;
  comments?: Array<{ id: string }>;
  faceProcessed?: boolean;
  originalUrl?: string;
}

interface Ceremony {
  id: string;
  name: string;
  order: number;
  photos: Photo[];
}

interface ActivityLog {
  id: string;
  guestId: string | null;
  eventType: string;
  payload: string | null;
  createdAt: string;
  guest?: {
    name: string;
    email: string | null;
  };
}

interface Album {
  id: string;
  title: string;
  clientName: string;
  shareToken: string;
  expiresAt: string | null;
  compressionQuality?: number;
  compressionFormat?: CompressionFormat;
  dedupThreshold?: number;
  ceremonies: Ceremony[];
  activityLogs?: ActivityLog[];
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
  const { toast, confirm, prompt } = useToast();
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCeremony, setActiveCeremony] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isPreparingUploads, setIsPreparingUploads] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);
  const [isApplyingBlur, setIsApplyingBlur] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compressionFormat, setCompressionFormat] = useState<CompressionFormat>("webp");
  const [compressionQuality, setCompressionQuality] = useState(80);
  const [compressionConcurrency, setCompressionConcurrency] = useState(2);
  const [dedupThreshold, setDedupThreshold] = useState(10);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  const [isFindingDuplicates, setIsFindingDuplicates] = useState(false);
  const [duplicateScanError, setDuplicateScanError] = useState("");
  const [duplicateSourcePhotos, setDuplicateSourcePhotos] = useState<Photo[] | null>(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [isReprocessingFaces, setIsReprocessingFaces] = useState(false);

  const fetchAlbum = useCallback(async () => {
    const response = await fetch(`/api/albums/${albumId}`);
    if (!response.ok) return;
    const data = await response.json();
    setAlbum(data);
    setCompressionFormat(data.compressionFormat ?? "webp");
    setCompressionQuality(data.compressionQuality ?? 80);
    setDedupThreshold(data.dedupThreshold ?? 10);
    setActiveCeremony((current) => (data.ceremonies?.some((c: Ceremony) => c.id === current) ? current : data.ceremonies?.[0]?.id ?? null));
    const validPhotoIds = new Set((data.ceremonies ?? []).flatMap((c: Ceremony) => c.photos.map((photo) => photo.id)));
    setSelectedPhotos((prev) => prev.filter((id) => validPhotoIds.has(id)));
    setLoading(false);
  }, [albumId]);

  useEffect(() => {
    fetchAlbum();
  }, [fetchAlbum]);

  useEffect(() => {
    if (!lightbox) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
      if (event.key === "ArrowRight") setLightbox((current) => current ? { ...current, index: Math.min(current.index + 1, current.photos.length - 1) } : null);
      if (event.key === "ArrowLeft") setLightbox((current) => current ? { ...current, index: Math.max(current.index - 1, 0) } : null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox]);

  useEffect(() => {
    setDuplicateSourcePhotos(null);
    setShowDuplicateModal(false);
    setDuplicateScanError("");
  }, [activeCeremony]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!activeCeremony || acceptedFiles.length === 0) return;
    setIsPreparingUploads(true);
    try {
      const preparedFiles = await mapWithConcurrency(
        acceptedFiles,
        compressionConcurrency,
        async (file, index) => {
          const startedAt = performance.now();
          console.info(`[upload-prepare] start ${index + 1}/${acceptedFiles.length}: ${file.name} (${formatMb(file.size)} MB) using ${compressionFormat}`);
          const preparedFile = await compressImageFile(file, compressionFormat, compressionQuality);
          const elapsedMs = Math.round(performance.now() - startedAt);
          console.info(`[upload-prepare] done ${index + 1}/${acceptedFiles.length}: ${file.name} -> ${preparedFile.name} (${formatMb(file.size)} MB -> ${formatMb(preparedFile.size)} MB) in ${elapsedMs}ms`);
          return preparedFile;
        }
      );
      const prepared: UploadItem[] = preparedFiles.map((file) => ({
        file,
        ceremonyId: activeCeremony,
        status: "pending",
        progress: 0,
      }));
      setUploads((prev) => [...prev, ...prepared]);
    } finally {
      setIsPreparingUploads(false);
    }
  }, [activeCeremony, compressionConcurrency, compressionFormat, compressionQuality]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp", ".heic"] },
    multiple: true,
  });

  const xhrUploadWithProgress = (url: string, file: File, onProgress: (pct: number) => void, retries = 3) =>
    new Promise<void>((resolve, reject) => {
      let attempt = 0;
      const tryUpload = () => {
        attempt += 1;
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? (onProgress(100), resolve()) : reject(new Error(`Upload failed (HTTP ${xhr.status})`));
        xhr.onerror = () => attempt < retries ? window.setTimeout(tryUpload, Math.pow(2, attempt - 1) * 1000) : reject(new Error(`Upload failed after ${retries} retries`));
        xhr.send(file);
      };
      tryUpload();
    });

  const duplicateGroups = buildDuplicateGroups(duplicateSourcePhotos ?? [], dedupThreshold);

  const uploadAll = async () => {
    const pending = uploads.filter((item) => item.status === "pending");
    if (!pending.length) return;
    setIsUploading(true);
    for (const item of pending) {
      const index = uploads.findIndex((entry) => entry.file === item.file && entry.ceremonyId === item.ceremonyId);
      setUploads((prev) => prev.map((entry, i) => i === index ? { ...entry, status: "uploading", progress: 0 } : entry));
      try {
        const metaRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ceremonyId: item.ceremonyId, filename: item.file.name, contentType: item.file.type, size: item.file.size }),
        });
        if (!metaRes.ok) throw new Error("Failed to get upload URL");
        const { uploadUrl } = await metaRes.json();
        await xhrUploadWithProgress(uploadUrl, item.file, (progress) => {
          setUploads((prev) => prev.map((entry, i) => i === index ? { ...entry, progress } : entry));
        });
        setUploads((prev) => prev.map((entry, i) => i === index ? { ...entry, status: "done", progress: 100 } : entry));
      } catch (error) {
        setUploads((prev) => prev.map((entry, i) => i === index ? { ...entry, status: "error", error: String(error) } : entry));
      }
    }
    setIsUploading(false);
    await fetchAlbum();
    window.setTimeout(() => setUploads((prev) => prev.filter((entry) => entry.status !== "done")), 2000);
  };

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
    toast("Share link copied to clipboard!", "success");
    window.setTimeout(() => setLinkCopied(false), 2500);
  };

  const deleteAlbum = async () => {
    if (!album) return;
    const ok = await confirm("Delete this entire album and all photos? This cannot be undone.");
    if (!ok) return;
    const response = await fetch(`/api/albums/${album.id}`, { method: "DELETE" });
    if (response.ok) window.location.href = "/";
    else toast("Failed to delete album.", "error");
  };

  const addCeremony = async () => {
    const name = await prompt("New Ceremony Name:", "e.g. Mehndi, Reception…");
    if (!name?.trim()) return;
    const response = await fetch("/api/ceremonies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), albumId }),
    });
    if (response.ok) await fetchAlbum();
    else toast("Failed to add ceremony.", "error");
  };

  const deleteCeremony = async (ceremonyId: string) => {
    const ok = await confirm("Delete this ceremony and all of its photos permanently?");
    if (!ok) return;
    const response = await fetch(`/api/ceremonies/${ceremonyId}`, { method: "DELETE" });
    if (response.ok) await fetchAlbum();
    else toast("Failed to delete ceremony.", "error");
  };

  const deletePhoto = async (photoId: string) => {
    const ok = await confirm("Delete this photo forever?");
    if (!ok) return;
    const response = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
    if (response.ok) await fetchAlbum();
    else toast("Failed to delete photo.", "error");
  };

  const togglePhotoSelection = (photoId: string, selected: boolean) => {
    setSelectedPhotos((prev) => selected ? (prev.includes(photoId) ? prev : [...prev, photoId]) : prev.filter((id) => id !== photoId));
  };

  const applyBlur = async (isBlurred: boolean) => {
    if (!selectedPhotos.length) return;
    setIsApplyingBlur(true);
    try {
      const response = await fetch("/api/photos/blur-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: selectedPhotos, isBlurred }),
      });
      if (!response.ok) throw new Error();
      setAlbum((current) => current ? ({
        ...current,
        ceremonies: current.ceremonies.map((ceremony) => ({
          ...ceremony,
          photos: ceremony.photos.map((photo) => selectedPhotos.includes(photo.id) ? { ...photo, isBlurred } : photo),
        })),
      }) : current);
      toast(`${selectedPhotos.length} photo(s) ${isBlurred ? "blurred" : "unblurred"}.`, "success");
    } catch {
      toast(`Failed to ${isBlurred ? "blur" : "unblur"} selected photos.`, "error");
    } finally {
      setIsApplyingBlur(false);
    }
  };

  const deleteSelectedPhotos = async () => {
    const ok = await confirm(`Delete ${selectedPhotos.length} selected photo(s)? This cannot be undone.`);
    if (!ok) return;
    setIsDeletingBatch(true);
    try {
      const response = await fetch("/api/photos/delete-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: selectedPhotos }),
      });
      if (!response.ok) throw new Error();
      setSelectedPhotos([]);
      await fetchAlbum();
      toast("Photos deleted.", "success");
    } catch {
      toast("Failed to delete photos.", "error");
    } finally {
      setIsDeletingBatch(false);
    }
  };

  const saveAlbumDefaults = async () => {
    if (!album) return;
    setIsSavingDefaults(true);
    try {
      const response = await fetch(`/api/albums/${album.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compressionFormat, compressionQuality, dedupThreshold }),
      });
      if (!response.ok) throw new Error();
      setAlbum((current) => current ? { ...current, compressionFormat, compressionQuality, dedupThreshold } : current);
      toast("Album defaults saved.", "success");
    } catch {
      toast("Failed to save album defaults.", "error");
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const scanDuplicates = async (forceRescan = false) => {
    const activeCeremonyData = album?.ceremonies.find((ceremony) => ceremony.id === activeCeremony);
    if (!activeCeremonyData) return;
    setIsFindingDuplicates(true);
    setDuplicateScanError("");
    if (forceRescan) {
      setDuplicateSourcePhotos(null);
      setShowDuplicateModal(false);
    }
    try {
      const originals = activeCeremonyData.photos.filter((photo) => !photo.isReturn);
      const hashedPhotos: Photo[] = [];
      const newHashes: Array<{ photoId: string; imageHash: string }> = [];
      for (const photo of originals) {
        if (!forceRescan && photo.imageHash) {
          hashedPhotos.push(photo);
          continue;
        }
        const imageHash = await computeDHashFromUrl(photo.url, { cacheBust: forceRescan });
        hashedPhotos.push({ ...photo, imageHash });
        newHashes.push({ photoId: photo.id, imageHash });
      }
      setDuplicateSourcePhotos(hashedPhotos);
      setShowDuplicateModal(true);
      if (newHashes.length) {
        void Promise.all(newHashes.map(({ photoId, imageHash }) => fetch(`/api/photos/${photoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageHash }),
        })));
        setAlbum((current) => current ? ({
          ...current,
          ceremonies: current.ceremonies.map((ceremony) => ceremony.id !== activeCeremonyData.id ? ceremony : {
            ...ceremony,
            photos: ceremony.photos.map((photo) => {
              const match = hashedPhotos.find((candidate) => candidate.id === photo.id);
              return match ? { ...photo, imageHash: match.imageHash } : photo;
            }),
          }),
        }) : current);
      }
    } catch {
      setDuplicateScanError("Could not scan for duplicates in this ceremony.");
    } finally {
      setIsFindingDuplicates(false);
    }
  };

  const findDuplicates = async () => {
    await scanDuplicates(false);
  };

  const rescanDuplicates = async () => {
    await scanDuplicates(true);
  };

  const reprocessFaces = async () => {
    if (!album) return;
    const ok = await confirm("Clear saved face matches for this album and reprocess them with the latest model?");
    if (!ok) return;
    setIsReprocessingFaces(true);
    try {
      const response = await fetch(`/api/albums/${album.id}/reprocess-faces`, { method: "POST" });
      if (!response.ok) throw new Error();
      await fetchAlbum();
      toast("Face data reset. Reprocessing will begin on next album open.", "success");
    } catch {
      toast("Failed to reset face processing for this album.", "error");
    } finally {
      setIsReprocessingFaces(false);
    }
  };

  const activeCeremonyData = album?.ceremonies.find((ceremony) => ceremony.id === activeCeremony);

  if (loading) return <CenteredState><Loader2 size={32} color="var(--taupe)" style={{ animation: "spin 1s linear infinite" }} /></CenteredState>;
  if (!album || (!activeCeremonyData && activeCeremony !== "ACTIVITY")) return <CenteredState><p>Album not found.</p></CenteredState>;

  const totalPhotos = album.ceremonies.reduce((sum, ceremony) => sum + ceremony.photos.length, 0);
  const originalCount = activeCeremonyData ? activeCeremonyData.photos.filter((photo) => !photo.isReturn).length : 0;
  const selectedCount = activeCeremonyData ? activeCeremonyData.photos.filter((photo) => !photo.isReturn && photo.isSelected).length : 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)" }}>
      <header className="glass px-4 md:px-8" style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid var(--sand)" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
            <Link href="/" className="btn-ghost" style={{ textDecoration: "none", padding: "8px 12px", fontSize: 13 }}><ArrowLeft size={14} />Albums</Link>
            <div style={{ width: 1, height: 20, background: "var(--sand)" }} />
            <div><span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--espresso)" }}>{album.title}</span><span style={{ fontSize: 13, color: "var(--taupe)", marginLeft: 10 }}>{album.clientName}</span></div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btn-ghost" onClick={deleteAlbum} style={{ fontSize: 13, color: "var(--blush)" }}><Trash2 size={14} />Delete Album</button>
            <Link href={`/share/${album.shareToken}`} target="_blank" className="btn-ghost" style={{ textDecoration: "none", fontSize: 13 }}><ExternalLink size={14} />Preview</Link>
            <button className="btn-gold" onClick={copyShareLink} style={{ fontSize: 13 }}>{linkCopied ? <Check size={14} /> : <Share2 size={14} />}{linkCopied ? "Copied!" : "Share Link"}</button>
          </div>
        </div>
      </header>

      <div className="flex flex-col md:flex-row" style={{ maxWidth: 1400, margin: "0 auto", minHeight: "calc(100vh - 64px)" }}>
        <aside className="w-full md:w-[240px] border-b md:border-b-0 md:border-r border-[var(--sand)] py-4 md:py-7 flex-shrink-0 overflow-x-auto whitespace-nowrap">
          <div className="px-4 md:px-5 mb-0 md:mb-5 inline-block md:block align-middle">
            <p className="hidden md:block" style={{ fontSize: 11, color: "var(--taupe)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>Ceremonies</p>
            <p className="hidden md:block" style={{ fontSize: 12, color: "var(--brown)" }}>{totalPhotos} photos total</p>
          </div>
          <div className="inline-flex md:block items-center gap-2 px-4 md:px-0 py-2 md:py-0">
            {album.ceremonies.map((ceremony) => {
              const originals = ceremony.photos.filter((photo) => !photo.isReturn);
              const finals = ceremony.photos.filter((photo) => photo.isReturn);
              const selected = originals.filter((photo) => photo.isSelected).length;
              return <button key={ceremony.id} onClick={() => setActiveCeremony(ceremony.id)} className="flex items-center gap-3 md:justify-between px-4 md:px-5 py-2 md:py-2.5 rounded-full md:rounded-none transition-all text-left border md:border-0 md:border-l-[3px]" style={{ background: activeCeremony === ceremony.id ? "var(--warm-white)" : "transparent", borderColor: activeCeremony === ceremony.id ? "var(--gold)" : "var(--sand)", cursor: "pointer" }}><span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: activeCeremony === ceremony.id ? "var(--espresso)" : "var(--brown)", fontWeight: activeCeremony === ceremony.id ? 500 : 400 }}><FolderOpen size={14} />{ceremony.name}</span><div style={{ display: "flex", alignItems: "center", gap: 4 }}>{finals.length > 0 ? <span style={pill("rgba(201,150,58,0.2)", "var(--gold)")}>FINALS</span> : null}{selected > 0 ? <span style={pill("rgba(201,150,58,0.12)", "var(--gold)")}>S:{selected}</span> : null}<span style={{ fontSize: 11, color: "var(--taupe)", background: "var(--sand)", padding: "2px 7px", borderRadius: 100 }}>{originals.length}</span></div></button>;
            })}
            <button onClick={addCeremony} className="flex items-center gap-2 justify-center px-4 md:px-5 py-2 md:py-3 transition-colors text-[var(--taupe)] hover:text-[var(--gold)] border-t border-[var(--sand)] md:w-full" style={{ fontSize: 13, fontWeight: 500 }}><span style={{ fontSize: 18 }}>+</span> Add Ceremony</button>
            <div style={{ height: 1, background: "var(--sand)", margin: "16px 20px" }} />
            <button onClick={() => setActiveCeremony("ACTIVITY")} className="flex items-center gap-3 md:justify-between px-4 md:px-5 py-2 md:py-2.5 rounded-full md:rounded-none transition-all text-left border md:border-0 md:border-l-[3px]" style={{ background: activeCeremony === "ACTIVITY" ? "var(--warm-white)" : "transparent", borderColor: activeCeremony === "ACTIVITY" ? "var(--gold)" : "var(--sand)", cursor: "pointer" }}><span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: activeCeremony === "ACTIVITY" ? "var(--espresso)" : "var(--brown)", fontWeight: activeCeremony === "ACTIVITY" ? 500 : 400 }}><Activity size={14} />Activity Feed</span></button>
          </div>
        </aside>

        <main className="flex-1 p-4 md:p-8 overflow-auto">
          {activeCeremony === "ACTIVITY" ? (
            <div>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 28, flexWrap: "wrap", borderBottom: "1px solid var(--sand)", paddingBottom: 16 }}>
                <div>
                  <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--espresso)", display: "flex", alignItems: "center", gap: 12 }}>
                    <Activity size={24} color="var(--gold)" />
                    Activity Feed
                  </h2>
                  <p style={{ fontSize: 13, color: "var(--brown)", marginTop: 4 }}>
                    See when guests interact with the shared gallery.
                  </p>
                </div>
              </div>
              <ActivityFeed logs={album.activityLogs || []} />
            </div>
          ) : activeCeremonyData && (
            <>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--espresso)" }}>{activeCeremonyData.name}</h2>
                <button onClick={() => deleteCeremony(activeCeremonyData.id)} title="Delete Ceremony" style={{ color: "var(--blush)", opacity: 0.7, cursor: "pointer", background: "none", border: "none", padding: 0 }}><Trash2 size={16} /></button>
              </div>
              <p style={{ fontSize: 13, color: "var(--brown)", marginTop: 2 }}>{originalCount} photos uploaded{activeCeremonyData.photos.some((photo) => photo.isReturn) ? <span style={{ color: "var(--gold)", marginLeft: 8 }}>· {activeCeremonyData.photos.filter((photo) => photo.isReturn).length} finals delivered</span> : null}</p>
              {selectedCount > 0 ? <p style={{ fontSize: 12, color: "var(--gold)", marginTop: 4 }}>Client has selected {selectedCount} of {originalCount} original photos.</p> : null}
              {duplicateScanError ? <p style={{ fontSize: 12, color: "var(--blush)", marginTop: 6 }}>{duplicateScanError}</p> : null}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-ghost" onClick={reprocessFaces} style={{ fontSize: 12 }} disabled={isReprocessingFaces}>{isReprocessingFaces ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : null}{isReprocessingFaces ? "Resetting..." : "Reprocess Faces"}</button>
              <button className="btn-ghost" onClick={findDuplicates} style={{ fontSize: 12 }} disabled={isFindingDuplicates}>{isFindingDuplicates ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={12} />}{isFindingDuplicates ? "Scanning..." : "Find Duplicates"}</button>
              <button className="btn-ghost" onClick={rescanDuplicates} style={{ fontSize: 12 }} disabled={isFindingDuplicates}>{isFindingDuplicates ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={12} />}{isFindingDuplicates ? "Scanning..." : "Rescan Duplicates"}</button>
              {activeCeremonyData.photos.some((photo) => photo.isReturn) ? <button className="btn-gold" onClick={() => downloadFinals(album, activeCeremonyData)} style={{ fontSize: 12 }}><PackageCheck size={12} />Download Finals</button> : null}
            </div>
          </div>

          <div {...getRootProps()} style={{ border: `2px dashed ${isDragActive ? "var(--gold)" : "var(--sand)"}`, borderRadius: 16, padding: "32px 24px", textAlign: "center", background: isDragActive ? "rgba(201, 150, 58, 0.04)" : "var(--warm-white)", cursor: "pointer", transition: "all 0.2s ease", marginBottom: 16 }}>
            <input {...getInputProps()} />
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: isDragActive ? "var(--gold)" : "var(--sand)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}><Upload size={20} color={isDragActive ? "#fff" : "var(--brown)"} /></div>
            <p style={{ fontSize: 15, color: "var(--espresso)", fontWeight: 500, marginBottom: 4 }}>{isDragActive ? "Drop photos here" : "Drag & drop photos"}</p>
            <p style={{ fontSize: 13, color: "var(--brown)" }}>or <span style={{ color: "var(--gold)", textDecoration: "underline" }}>browse files</span> · JPG, PNG, WebP, HEIC up to 100MB</p>
            {isPreparingUploads ? <p style={{ fontSize: 12, color: "var(--gold)", marginTop: 10 }}>Preparing files with album compression settings...</p> : null}
          </div>

          <div className="card" style={{ padding: 18, marginBottom: 24 }}>
            <button onClick={() => setSettingsOpen((prev) => !prev)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", color: "var(--espresso)" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600 }}><Settings2 size={16} color="var(--gold)" />Upload Settings</span>{settingsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
            {settingsOpen ? <div style={{ marginTop: 18, display: "grid", gap: 18 }}><div><p style={settingsLabel}>Compression Format</p><div style={{ display: "flex", gap: 8 }}>{(["webp", "jpeg", "original"] as CompressionFormat[]).map((format) => <button key={format} onClick={() => setCompressionFormat(format)} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${compressionFormat === format ? "var(--gold)" : "var(--sand)"}`, background: compressionFormat === format ? "rgba(201,150,58,0.08)" : "var(--warm-white)", color: compressionFormat === format ? "var(--espresso)" : "var(--brown)", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>{format.toUpperCase()}</button>)}</div></div><label style={{ display: "grid", gap: 8 }}><span style={settingsLabel}>Quality: {compressionQuality}%</span><input type="range" min={10} max={100} value={compressionQuality} onChange={(event) => setCompressionQuality(Number(event.target.value))} /></label><label style={{ display: "grid", gap: 8 }}><span style={settingsLabel}>Preparation Concurrency: {compressionConcurrency}</span><input type="range" min={1} max={4} value={compressionConcurrency} onChange={(event) => setCompressionConcurrency(Number(event.target.value))} /><span style={{ fontSize: 12, color: "var(--brown)" }}>Browser-only setting. Higher values may prepare faster on strong laptops but can make weaker machines stutter.</span></label><label style={{ display: "grid", gap: 8 }}><span style={settingsLabel}>Duplicate Threshold: {dedupThreshold}</span><input type="range" min={1} max={20} value={dedupThreshold} onChange={(event) => setDedupThreshold(Number(event.target.value))} /><span style={{ fontSize: 12, color: "var(--brown)" }}>Lower values are stricter. Higher values group looser visual matches.</span></label><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><p style={{ fontSize: 12, color: "var(--brown)" }}>{compressionFormat === "original" ? "New uploads keep their original file and quality." : "New uploads are compressed in the browser before they enter the queue."}</p><button className="btn-gold" onClick={saveAlbumDefaults} disabled={isSavingDefaults} style={{ fontSize: 12 }}>{isSavingDefaults ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={12} />}Save as album default</button></div></div> : null}
          </div>

          {uploads.length > 0 ? <UploadQueue uploads={uploads} isUploading={isUploading} onUploadAll={uploadAll} onClear={(index) => setUploads((prev) => prev.filter((_, i) => i !== index))} /> : null}

          {activeCeremonyData.photos.length > 0 ? <div className="photo-grid">{activeCeremonyData.photos.map((photo, index) => <PhotoCard key={photo.id} photo={photo} onDelete={deletePhoto} onSelect={togglePhotoSelection} onOpen={() => setLightbox({ photos: activeCeremonyData.photos, index })} isSelected={selectedPhotos.includes(photo.id)} showCheckbox={selectedPhotos.length > 0} />)}</div> : <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--taupe)" }}><ImageIcon size={40} style={{ marginBottom: 12, opacity: 0.4 }} /><p style={{ fontSize: 14 }}>No photos yet. Drop some above to get started.</p></div>}
          </>)}
        </main>
      </div>

      {selectedPhotos.length > 0 ? <div style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", background: "var(--espresso)", color: "#fff", padding: "12px 24px", borderRadius: 100, display: "flex", alignItems: "center", gap: 14, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", zIndex: 100, flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100vw - 32px)" }}><span style={{ fontSize: 13, fontWeight: 500 }}>{selectedPhotos.length} photo{selectedPhotos.length === 1 ? "" : "s"} selected</span><div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.2)" }} /><button onClick={() => setSelectedPhotos([])} style={{ background: "none", border: "none", color: "var(--sand)", cursor: "pointer", fontSize: 13 }}>Cancel</button><button onClick={() => applyBlur(true)} disabled={isApplyingBlur} style={selectionAction("var(--gold)")}>{isApplyingBlur ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : null}Blur Selected</button><button onClick={() => applyBlur(false)} disabled={isApplyingBlur} style={selectionAction("rgba(250,247,242,0.14)")}>{isApplyingBlur ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : null}Unblur Selected</button><button onClick={deleteSelectedPhotos} disabled={isDeletingBatch} style={selectionAction("var(--blush)")}>{isDeletingBatch ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={14} />}Delete</button></div> : null}
      {lightbox ? <AlbumLightbox lightbox={lightbox} selectedPhotos={selectedPhotos} onClose={() => setLightbox(null)} onNavigate={(direction) => setLightbox((current) => current ? { ...current, index: direction === "next" ? Math.min(current.index + 1, current.photos.length - 1) : Math.max(current.index - 1, 0) } : null)} onToggleSelect={(photoId) => togglePhotoSelection(photoId, !selectedPhotos.includes(photoId))} /> : null}
      {showDuplicateModal ? <DuplicateModal groups={duplicateGroups} threshold={dedupThreshold} onClose={() => setShowDuplicateModal(false)} onSelectDuplicates={() => { setSelectedPhotos((prev) => Array.from(new Set([...prev, ...duplicateGroups.flatMap((group) => group.duplicates.map((photo) => photo.id))]))); setShowDuplicateModal(false); }} /> : null}
      <FaceProcessor photos={album.ceremonies.flatMap((ceremony) => ceremony.photos.map((photo) => { const useOriginal = FACE_CONFIG.scanSource === "original" && Boolean(photo.originalUrl); return { id: photo.id, url: useOriginal ? photo.originalUrl! : photo.url, faceProcessed: Boolean(photo.faceProcessed), scanSource: useOriginal ? "original" : "thumbnail" }; }))} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function UploadQueue({ uploads, isUploading, onUploadAll, onClear }: { uploads: UploadItem[]; isUploading: boolean; onUploadAll: () => void; onClear: (index: number) => void; }) {
  return <div className="card" style={{ padding: 20, marginBottom: 24 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}><p style={{ fontSize: 13, fontWeight: 500, color: "var(--espresso)" }}>Upload Queue ({uploads.filter((item) => item.status === "pending").length} pending)</p><button className="btn-primary" onClick={onUploadAll} disabled={isUploading || uploads.every((item) => item.status !== "pending")} style={{ fontSize: 12, padding: "8px 16px" }}>{isUploading ? <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />Uploading...</> : <><Upload size={12} />Upload All</>}</button></div><div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{uploads.map((item, index) => <div key={`${item.file.name}-${index}`} style={{ background: "var(--warm-white)", borderRadius: 8, overflow: "hidden" }}><div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px" }}><StatusIcon status={item.status} /><span style={{ flex: 1, fontSize: 13, color: "var(--espresso)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.file.name}</span>{item.status === "uploading" ? <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600, minWidth: 36, textAlign: "right" }}>{item.progress}%</span> : null}<span style={{ fontSize: 11, color: "var(--taupe)" }}>{(item.file.size / 1024 / 1024).toFixed(1)} MB</span>{item.status !== "uploading" ? <button onClick={() => onClear(index)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--taupe)", display: "flex" }}><X size={12} /></button> : null}</div>{item.status === "uploading" ? <div style={{ height: 3, background: "var(--sand)" }}><div style={{ height: "100%", width: `${item.progress}%`, background: "var(--gold)", transition: "width 0.3s ease" }} /></div> : null}</div>)}</div></div>;
}

function StatusIcon({ status }: { status: UploadStatus }) {
  if (status === "uploading") return <Loader2 size={14} color="var(--gold)" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />;
  if (status === "done") return <Check size={14} color="var(--sage)" style={{ flexShrink: 0 }} />;
  if (status === "error") return <X size={14} color="var(--blush)" style={{ flexShrink: 0 }} />;
  return <div style={{ width: 14, height: 14, borderRadius: "50%", border: "1.5px solid var(--taupe)", flexShrink: 0 }} />;
}

function PhotoCard({ photo, onDelete, onSelect, onOpen, isSelected, showCheckbox }: { photo: Photo; onDelete: (id: string) => void; onSelect: (id: string, selected: boolean) => void; onOpen: () => void; isSelected: boolean; showCheckbox: boolean; }) {
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const checkboxVisible = showCheckbox || hovered || isSelected;
  return <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={onOpen} style={{ aspectRatio: "1", borderRadius: 10, overflow: "hidden", background: "var(--sand)", position: "relative", cursor: "pointer" }}>{!loaded ? <div className="skeleton" style={{ position: "absolute", inset: 0 }} /> : null}<img src={photo.url} alt={photo.originalName} onLoad={() => setLoaded(true)} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: loaded ? 1 : 0, transition: "opacity 0.3s ease, transform 0.25s ease, filter 0.25s ease", transform: hovered ? "scale(1.02)" : "scale(1)", filter: photo.isBlurred ? "blur(12px) saturate(0)" : "none" }} />{checkboxVisible ? <div onClick={(event) => { event.stopPropagation(); onSelect(photo.id, !isSelected); }} style={{ position: "absolute", top: 8, left: 8, zIndex: 10, width: 20, height: 20, borderRadius: 4, background: isSelected ? "var(--gold)" : "rgba(255,255,255,0.86)", border: isSelected ? "none" : "2px solid var(--taupe)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>{isSelected ? <Check size={14} color="#fff" strokeWidth={3} /> : null}</div> : null}{photo.isBlurred ? <div title="Blurred in album manager" style={{ position: "absolute", top: 8, left: checkboxVisible ? 36 : 8, zIndex: 10, width: 22, height: 22, borderRadius: 999, background: "rgba(26,18,8,0.78)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}><Lock size={12} /></div> : null}{photo.comments?.length ? <div title={`${photo.comments.length} note(s)`} style={{ position: "absolute", top: 10, right: 10, width: 10, height: 10, borderRadius: "50%", background: "var(--gold)", border: "2px solid #fff", boxShadow: "0 2px 4px rgba(0,0,0,0.2)", zIndex: 5 }} /> : null}{photo.isSelected ? <div title="Client selected" style={{ position: "absolute", bottom: 8, right: 8, fontSize: 14, lineHeight: 1, color: "var(--gold)", textShadow: "0 1px 3px rgba(0,0,0,0.5)", zIndex: 5, pointerEvents: "none" }}>★</div> : null}<div style={{ position: "absolute", inset: 0, background: hovered ? "rgba(26,18,8,0.16)" : "transparent", transition: "background 0.2s ease" }} /><div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "24px 8px 8px", background: "linear-gradient(transparent, rgba(26,18,8,0.58))", opacity: hovered ? 1 : 0, transition: "opacity 0.2s" }}><p style={{ fontSize: 11, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 24 }}>{photo.originalName}</p><button onClick={(event) => { event.stopPropagation(); onDelete(photo.id); }} style={{ position: "absolute", bottom: 6, right: 6, background: "var(--blush)", border: "none", color: "#fff", borderRadius: 4, padding: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={12} /></button></div></div>;
}

function CenteredState({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cream)" }}>{children}<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style></div>;
}

function downloadFinals(album: Album, ceremony: Ceremony) {
  const finals = ceremony.photos.filter((photo) => photo.isReturn);
  if (!finals.length) return;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `/api/albums/${album.id}/download`;
  appendHidden(form, "photoIds", JSON.stringify(finals.map((photo) => photo.id)));
  appendHidden(form, "bundleName", `${ceremony.name} - Finals`);
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

function appendHidden(form: HTMLFormElement, name: string, value: string) {
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  form.appendChild(input);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker())
  );

  return results;
}

function formatMb(size: number) {
  return (size / 1024 / 1024).toFixed(1);
}

function parseActivityPayload(payload: string | null) {
  if (!payload) return null;
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function formatRelativeTime(value: string) {
  const diffMs = new Date(value).getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (absMs < 60_000) {
    return rtf.format(Math.round(diffMs / 1000), "second");
  }
  if (absMs < 3_600_000) {
    return rtf.format(Math.round(diffMs / 60_000), "minute");
  }
  if (absMs < 86_400_000) {
    return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  }
  return rtf.format(Math.round(diffMs / 86_400_000), "day");
}

function ActivityFeed({ logs }: { logs: ActivityLog[] }) {
  if (!logs.length) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--taupe)" }}>
        <History size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
        <p style={{ fontSize: 14 }}>No guest activity yet.</p>
        <p style={{ fontSize: 13, marginTop: 6, opacity: 0.8 }}>When someone views the gallery or downloads photos, it will appear here.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12, paddingBottom: 64 }}>
      {logs.map((log) => {
        let title = "Unknown activity";
        let description: React.ReactNode = "";
        let Icon = Activity;
        let color = "var(--taupe)";
        let bgColor = "var(--sand)";

        const guestName = log.guest?.name?.trim() || "Unknown guest";
        const guestEmail = log.guest?.email?.trim() || null;
        const name = log.guest?.name ? <strong>{log.guest.name}</strong> : "A guest";
        const payloadData = parseActivityPayload(log.payload);

        if (log.eventType === "guest_login") {
          title = "OTP Verified";
          description = <>{name} accessed the private gallery link using OTP.</>;
          Icon = User;
          color = "var(--sage)";
          bgColor = "rgba(164, 184, 151, 0.15)";
        } else if (log.eventType === "gallery_viewed") {
          title = "Gallery Opened";
          description = <>{name} opened the shared gallery.</>;
          Icon = Activity;
          color = "#3b82f6";
          bgColor = "rgba(59, 130, 246, 0.1)";
        } else if (log.eventType === "photo_selected") {
          title = "Photo Selected";
          description = <>{name} selected a photo.</>;
          Icon = Check;
          color = "var(--gold)";
          bgColor = "rgba(201, 150, 58, 0.15)";
        } else if (log.eventType === "photo_deselected") {
          title = "Photo Deselected";
          description = <>{name} removed a photo from their selection.</>;
          Icon = X;
          color = "var(--taupe)";
          bgColor = "rgba(176, 164, 147, 0.15)";
        } else if (log.eventType === "face_scan_completed" || log.eventType === "face_scan") {
          title = "Face Scan Completed";
          description = <>{name} successfully scanned their face to discover matching photos.</>;
          Icon = Camera;
          color = "var(--blue, #3b82f6)";
          bgColor = "rgba(59, 130, 246, 0.1)";
        } else if (log.eventType === "download_started" || log.eventType === "photo_download") {
          title = "Download Started";
          const count = typeof payloadData?.count === "number" ? payloadData.count : 1;
          description = <>{name} downloaded {count} photo{count === 1 ? "" : "s"}.</>;
          Icon = Download;
          color = "var(--gold)";
          bgColor = "rgba(201, 150, 58, 0.15)";
        }

        const date = new Date(log.createdAt);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });

        return (
          <div key={log.id} style={{ display: "flex", gap: 16, background: "var(--warm-white)", padding: "16px", borderRadius: 12, border: "1px solid var(--sand)" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: bgColor, color: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--espresso)" }}>{title}</p>
                  <p style={{ fontSize: 12, color: "var(--taupe)", marginTop: 2 }}>
                    {guestName}{guestEmail ? ` · ${guestEmail}` : ""}
                  </p>
                </div>
                <span style={{ fontSize: 11, color: "var(--taupe)", whiteSpace: "nowrap" }}>{formatRelativeTime(log.createdAt)}</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--brown)", marginTop: 2, lineHeight: 1.4 }}>{description}</p>
              <p style={{ fontSize: 11, color: "var(--taupe)", marginTop: 6 }}>{dateStr} at {timeStr}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const settingsLabel = { fontSize: 12, color: "var(--taupe)", textTransform: "uppercase" as const, letterSpacing: "0.08em" };
const pill = (background: string, color: string) => ({ fontSize: 9, background, color, padding: "1px 5px", borderRadius: 100, fontWeight: 600 } as const);
const selectionAction = (background: string) => ({ background, border: "none", color: "#fff", borderRadius: 100, padding: "6px 16px", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 } as const);
