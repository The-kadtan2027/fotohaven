"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Download, Sparkles, X } from "lucide-react";
import { FACE_CONFIG } from "@/lib/face-config";
import { averageDescriptors } from "@/lib/face-math";

type Photo = {
  id: string;
  originalName: string;
  url: string;
  originalUrl?: string;
};

type MatchSource = "selfie" | "refined";

type MatchedPhoto = Photo & { score: number };

type Ceremony = {
  id: string;
  name: string;
  photos: Photo[];
};

type Album = {
  id: string;
  title: string;
  ceremonies: Ceremony[];
};

type Step = "otp" | "consent" | "scan" | "results";

type MatchResponse = {
  photos?: { photoId: string; score: number }[];
  guest?: { name?: string };
  source?: MatchSource;
  error?: string;
};

export default function GuestFaceDiscoveryPage() {
  const { token } = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>("otp");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [matchedPhotos, setMatchedPhotos] = useState<MatchedPhoto[]>([]);
  const [guestName, setGuestName] = useState("");
  const [isReturningGuest, setIsReturningGuest] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [confirmedPhotoIds, setConfirmedPhotoIds] = useState<string[]>([]);
  const [matchSource, setMatchSource] = useState<MatchSource>("selfie");
  const [lightbox, setLightbox] = useState<{ photos: MatchedPhoto[]; index: number } | null>(null);
  const [lightboxFullLoaded, setLightboxFullLoaded] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  async function requestOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setStatus("");

    try {
      const resp = await fetch("/api/guest/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, email }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Failed to send OTP");
      }

      setOtpSent(true);
      setStatus("OTP sent. Check your email.");
    } catch (err: any) {
      setError(err.message || "Failed to send OTP");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setBusy(true);
    setError("");
    setStatus("");

    try {
      const resp = await fetch("/api/guest/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, email, phone, otp }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "OTP verification failed");
      }
      const resolvedName = data.name || name;
      setGuestName(resolvedName);
      if (data.hasFaceDescriptor) {
        setIsReturningGuest(true);
        setStatus("Face profile found. Loading your matched photos...");
        await loadMatchedPhotos({ source: "selfie", fallbackName: resolvedName });
      } else {
        setIsReturningGuest(false);
        setStep("consent");
      }
    } catch (err: any) {
      setError(err.message || "OTP verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    setError("");
    setStatus("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      setError("Unable to access camera. You can browse all photos instead.");
    }
  }

  async function loadMatchedPhotos(options?: {
    source?: MatchSource;
    photoIds?: string[];
    fallbackName?: string;
  }) {
    const source = options?.source || "selfie";
    setStatus(source === "refined" ? "Finding more photos like these..." : "Finding your photos...");

    const matchResp = await fetch("/api/guest/my-photos", {
      method: source === "refined" ? "POST" : "GET",
      cache: "no-store",
      headers: source === "refined" ? { "Content-Type": "application/json" } : undefined,
      body: source === "refined" ? JSON.stringify({ photoIds: options?.photoIds || [] }) : undefined,
    });
    const matchData = (await matchResp.json()) as MatchResponse;
    if (!matchResp.ok) {
      throw new Error(matchData.error || "Failed to find matches");
    }

    const resolvedSource = matchData.source || source;
    setMatchSource(resolvedSource);
    setGuestName(matchData.guest?.name || options?.fallbackName || "");
    if (resolvedSource === "selfie") {
      setConfirmedPhotoIds([]);
    }

    const scored = matchData.photos || [];
    if (!scored.length) {
      setMatchedPhotos([]);
      setStep("results");
      setStatus("");
      return;
    }

    const albumResp = await fetch(`/api/share/${token}`, { cache: "no-store" });
    if (!albumResp.ok) {
      throw new Error("Face matched photos found, but gallery is unavailable right now.");
    }
    const album = (await albumResp.json()) as Album;
    const all = album.ceremonies.flatMap((ceremony) => ceremony.photos);
    const photoMap = new Map(all.map((p) => [p.id, p]));

    const matched: MatchedPhoto[] = scored
      .map((m) => {
        const photo = photoMap.get(m.photoId);
        return photo ? { ...photo, score: m.score } : null;
      })
      .filter((p): p is MatchedPhoto => p !== null);

    setMatchedPhotos(matched);
    setStep("results");
    setStatus("");
  }

  async function scanAndMatch() {
    if (!videoRef.current) return;
    setBusy(true);
    setError("");

    try {
      const SAMPLES = FACE_CONFIG.enrollmentSamples;
      const DELAY_MS = 500;
      const canvases: HTMLCanvasElement[] = [];

      for (let i = 0; i < SAMPLES; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
        setStatus(`Capturing sample ${i + 1} of ${SAMPLES} - hold still...`);

        const video = videoRef.current;
        if (!video) break;

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.drawImage(video, 0, 0);
        canvases.push(canvas);
      }

      stopCamera();

      setStatus("Loading models...");
      const faceapi = await import("face-api.js");
      await faceapi.nets.ssdMobilenetv1.loadFromUri("/models");
      await faceapi.nets.faceLandmark68Net.loadFromUri("/models");
      await faceapi.nets.faceRecognitionNet.loadFromUri("/models");

      setStatus("Computing face profile...");
      const collectedDescriptors: Float32Array[] = [];
      for (const canvas of canvases) {
        const detection = await faceapi
          .detectSingleFace(canvas)
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (detection) {
          collectedDescriptors.push(Float32Array.from(detection.descriptor));
        }
      }

      if (collectedDescriptors.length < FACE_CONFIG.enrollmentMinSuccess) {
        throw new Error(
          `Only ${collectedDescriptors.length} of ${SAMPLES} samples detected a face. Need at least ${FACE_CONFIG.enrollmentMinSuccess}. ` +
          "Make sure your face is well-lit and centred in the frame."
        );
      }

      const averaged = averageDescriptors(collectedDescriptors);
      const descriptor = Array.from(averaged);

      const enrollResp = await fetch("/api/guest/enroll-face", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptor }),
      });
      if (!enrollResp.ok) {
        const data = await enrollResp.json();
        throw new Error(data.error || "Failed to save face profile");
      }

      await loadMatchedPhotos({ source: "selfie" });
    } catch (err: any) {
      setError(err.message || "Scan failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function toggleConfirmedPhoto(photoId: string) {
    setError("");
    setConfirmedPhotoIds((prev) => {
      if (prev.includes(photoId)) {
        return prev.filter((id) => id !== photoId);
      }
      if (prev.length >= 3) {
        setError("Choose up to 3 confirmed photos for refined discovery.");
        return prev;
      }
      return [...prev, photoId];
    });
  }

  async function refineMatches() {
    if (!confirmedPhotoIds.length) {
      setError("Choose at least 1 confirmed photo first.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await loadMatchedPhotos({ source: "refined", photoIds: confirmedPhotoIds });
    } catch (err: any) {
      setError(err.message || "Failed to refine matches");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function rescanFace() {
    stopCamera();
    setLightbox(null);
    setMatchedPhotos([]);
    setConfirmedPhotoIds([]);
    setMatchSource("selfie");
    setIsReturningGuest(false);
    setStep("scan");
    void startCamera();
  }

  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setLightbox((lb) => lb && { ...lb, index: Math.min(lb.index + 1, lb.photos.length - 1) });
      if (e.key === "ArrowLeft") setLightbox((lb) => lb && { ...lb, index: Math.max(lb.index - 1, 0) });
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox]);

  useEffect(() => {
    setLightboxFullLoaded(false);
  }, [lightbox?.index, lightbox?.photos]);

  function downloadMatched() {
    if (!matchedPhotos.length) return;

    const form = document.createElement("form");
    form.method = "POST";
    form.action = `/api/share/${token}/download`;

    const idsInput = document.createElement("input");
    idsInput.type = "hidden";
    idsInput.name = "photoIds";
    idsInput.value = JSON.stringify(matchedPhotos.map((p) => p.id));
    form.appendChild(idsInput);

    const nameInput = document.createElement("input");
    nameInput.type = "hidden";
    nameInput.name = "bundleName";
    nameInput.value = "My Matched Photos";
    form.appendChild(nameInput);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  function downloadPhoto(photo: MatchedPhoto) {
    const link = document.createElement("a");
    link.href = photo.originalUrl || photo.url;
    link.download = photo.originalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const matchLabel = matchSource === "refined" ? "Refined matches" : "Initial selfie matches";

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)", padding: "32px 16px" }}>
      <div className="card" style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, color: "var(--espresso)" }}>
            Guest Photo Discovery
          </h1>
          <Link href={`/share/${token}`} className="btn-ghost" style={{ fontSize: 13 }}>
            Browse all photos instead
          </Link>
        </div>

        {step === "otp" && (
          <div style={{ marginTop: 24, display: "grid", gap: 14 }}>
            <p style={{ fontSize: 14, color: "var(--brown)" }}>
              Enter your details to receive a one-time passcode.
            </p>
            <form onSubmit={requestOtp} style={{ display: "grid", gap: 10, maxWidth: 460 }}>
              <input
                className="input"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="input"
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className="input"
                placeholder="Phone (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <button className="btn-gold" type="submit" disabled={busy || !name || !email}>
                {busy ? "Sending..." : "Send OTP"}
              </button>
            </form>

            {otpSent && (
              <div style={{ display: "grid", gap: 10, maxWidth: 460 }}>
                <input
                  className="input"
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  maxLength={6}
                />
                <button
                  className="btn-gold"
                  onClick={verifyOtp}
                  disabled={busy || otp.length !== 6}
                >
                  {busy ? "Verifying..." : "Verify OTP"}
                </button>
              </div>
            )}
          </div>
        )}

        {step === "consent" && (
          <div style={{ marginTop: 24, maxWidth: 700 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--espresso)" }}>
              Face scan consent
            </h2>
            <p style={{ marginTop: 10, fontSize: 14, color: "var(--brown)", lineHeight: 1.6 }}>
              With your permission, FotoHaven will scan your face once and compare it with faces already
              extracted from this album to find likely matches. You can skip this and browse all photos.
            </p>
            <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn-gold" onClick={() => { setStep("scan"); void startCamera(); }}>
                I consent, scan my face
              </button>
              <Link href={`/share/${token}`} className="btn-ghost">
                Browse all photos instead
              </Link>
            </div>
          </div>
        )}

        {step === "scan" && (
          <div style={{ marginTop: 24 }}>
            <p style={{ fontSize: 14, color: "var(--brown)", marginBottom: 12 }}>
              Position your face in frame, then run scan.
            </p>
            <video
              ref={videoRef}
              muted
              playsInline
              style={{
                width: "100%",
                maxWidth: 500,
                borderRadius: 12,
                background: "#111",
                border: "1px solid var(--sand)",
              }}
            />
            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn-gold" onClick={scanAndMatch} disabled={busy || !cameraReady}>
                {busy ? "Scanning..." : "Scan and find my photos"}
              </button>
              <Link href={`/share/${token}`} className="btn-ghost">
                Browse all photos instead
              </Link>
            </div>
          </div>
        )}

        {step === "results" && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--espresso)" }}>
                  Your matched photos ({matchedPhotos.length})
                </h2>
                {guestName ? (
                  <p style={{ marginTop: 6, fontSize: 14, color: "var(--brown)" }}>
                    {isReturningGuest ? `Welcome back, ${guestName}.` : `Welcome, ${guestName}.`} {matchLabel}.
                  </p>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn-ghost" onClick={rescanFace}>
                  Rescan Face
                </button>
                {matchedPhotos.length > 0 && (
                  <button className="btn-gold" onClick={downloadMatched}>
                    Download matched ZIP
                  </button>
                )}
              </div>
            </div>

            {matchedPhotos.length > 0 && (
              <div
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 12,
                  background: "rgba(196, 168, 108, 0.12)",
                  border: "1px solid rgba(139, 110, 60, 0.18)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 240 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--espresso)", fontWeight: 700, fontSize: 13 }}>
                    <Sparkles size={14} />
                    Find more photos like this person
                  </div>
                  <p style={{ marginTop: 6, fontSize: 13, color: "var(--brown)", lineHeight: 1.5 }}>
                    Select 1-3 photos that are definitely you. FotoHaven will use the in-album face descriptors from those photos to run a refined offline search.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--taupe)" }}>
                    Selected {confirmedPhotoIds.length}/3
                  </span>
                  <button
                    className="btn-gold"
                    onClick={refineMatches}
                    disabled={busy || confirmedPhotoIds.length === 0}
                  >
                    {busy && matchSource === "refined" ? "Refining..." : "Find more like these"}
                  </button>
                </div>
              </div>
            )}

            {matchedPhotos.length === 0 ? (
              <p style={{ marginTop: 14, color: "var(--brown)", fontSize: 14 }}>
                No strong matches found yet. You can browse all photos instead or rescan your face.
              </p>
            ) : (
              <div className="photo-grid" style={{ marginTop: 16 }}>
                {matchedPhotos.map((photo, index) => {
                  const selected = confirmedPhotoIds.includes(photo.id);
                  return (
                    <div
                      key={photo.id}
                      style={{
                        position: "relative",
                        borderRadius: 10,
                        overflow: "hidden",
                        background: "var(--sand)",
                        width: "100%",
                        boxShadow: selected ? "0 0 0 3px rgba(196, 168, 108, 0.85)" : undefined,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setLightbox({ photos: matchedPhotos, index })}
                        style={{ position: "relative", background: "transparent", display: "block", width: "100%", padding: 0, border: "none", cursor: "pointer" }}
                      >
                        <img
                          src={photo.url}
                          alt={photo.originalName}
                          style={{ width: "100%", height: "100%", objectFit: "cover", aspectRatio: "1 / 1" }}
                        />
                        <span
                          style={{
                            position: "absolute",
                            bottom: 6,
                            left: 6,
                            background:
                              photo.score < FACE_CONFIG.strongMatchThreshold
                                ? "rgba(34,197,94,0.88)"
                                : "rgba(234,179,8,0.88)",
                            color: "#fff",
                            borderRadius: 4,
                            padding: "2px 7px",
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.03em",
                          }}
                        >
                          {photo.score < FACE_CONFIG.strongMatchThreshold ? "Strong match" : "Possible match"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleConfirmedPhoto(photo.id)}
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          border: selected ? "none" : "1px solid rgba(255,255,255,0.9)",
                          background: selected ? "rgba(196, 168, 108, 0.96)" : "rgba(26,18,8,0.55)",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          backdropFilter: "blur(6px)",
                        }}
                        aria-label={selected ? "Remove confirmed photo" : "Confirm this photo is me"}
                      >
                        <Check size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {status && (
          <p style={{ marginTop: 14, color: "var(--taupe)", fontSize: 13 }}>{status}</p>
        )}
        {error && (
          <p style={{ marginTop: 14, color: "var(--blush)", fontSize: 13 }}>{error}</p>
        )}
      </div>

      {lightbox && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(26,18,8,0.95)", zIndex: 1000, display: "flex" }}
          onClick={() => setLightbox(null)}
        >
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
                {lightbox.index + 1} / {lightbox.photos.length} - {lightbox.photos[lightbox.index].originalName}
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
        </div>
      )}
    </div>
  );
}
