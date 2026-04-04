"use client";

import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { AlbumPhoto } from "./album-utils";

export interface LightboxState {
  photos: AlbumPhoto[];
  index: number;
}

export default function AlbumLightbox({
  lightbox,
  selectedPhotos,
  onClose,
  onNavigate,
  onToggleSelect,
}: {
  lightbox: LightboxState;
  selectedPhotos: string[];
  onClose: () => void;
  onNavigate: (direction: "next" | "prev") => void;
  onToggleSelect: (photoId: string) => void;
}) {
  const photo = lightbox.photos[lightbox.index];
  const [fullLoaded, setFullLoaded] = useState(false);

  useEffect(() => {
    setFullLoaded(false);
  }, [photo.id]);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(26,18,8,0.96)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={onClose}
    >
      <button
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={{ position: "absolute", top: 20, right: 20, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 10 }}
      >
        <X size={18} />
      </button>

      {lightbox.index > 0 ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onNavigate("prev");
          }}
          style={{ position: "absolute", left: 20, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 10 }}
        >
          <ChevronLeft size={20} />
        </button>
      ) : null}

      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: "min(100%, 1200px)" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ position: "relative", width: "100%", minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img
            src={photo.url}
            alt={photo.originalName}
            style={{ position: "absolute", maxWidth: "100%", maxHeight: "82vh", objectFit: "contain", borderRadius: 8, filter: "blur(18px)", transform: "scale(1.02)", opacity: fullLoaded ? 0 : 0.85, transition: "opacity 0.25s ease" }}
          />
          <img
            src={photo.originalUrl || photo.url}
            alt={photo.originalName}
            onLoad={() => setFullLoaded(true)}
            style={{ position: "relative", maxWidth: "100%", maxHeight: "82vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 20px 80px rgba(0,0,0,0.6)", opacity: fullLoaded ? 1 : 0, transition: "opacity 0.35s ease" }}
          />
        </div>

        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
            {lightbox.index + 1} / {lightbox.photos.length} · {photo.originalName}
          </span>
          <button
            onClick={() => onToggleSelect(photo.id)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.18)", background: selectedPhotos.includes(photo.id) ? "var(--gold)" : "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer", fontSize: 12 }}
          >
            <Check size={12} />
            {selectedPhotos.includes(photo.id) ? "Selected" : "Select"}
          </button>
        </div>
      </div>

      {lightbox.index < lightbox.photos.length - 1 ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onNavigate("next");
          }}
          style={{ position: "absolute", right: 20, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 10 }}
        >
          <ChevronRight size={20} />
        </button>
      ) : null}
    </div>
  );
}
