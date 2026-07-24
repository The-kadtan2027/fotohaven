"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Sparkles,
  X,
  Maximize,
  LayoutGrid,
  Columns,
  Square,
} from "lucide-react";
import { FACE_CONFIG } from "@/lib/face-config";
import { averageDescriptors } from "@/lib/face-math";

type Photo = {
  id: string;
  originalName: string;
  url: string;
  originalUrl?: string;
};

type MatchSource = "selfie" | "refined";

type MatchedPhoto = Photo & { score: number; faceCount?: number };

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

type Step = "otp" | "consent" | "scan" | "review" | "results";
type ViewMode = "grid" | "masonry" | "single";

type MatchResponse = {
  photos?: (Photo & { score: number; faceCount?: number })[];
  guest?: { name?: string };
  source?: MatchSource;
  thresholds?: { strong: number; possible: number };
  metric?: string;
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
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [lightbox, setLightbox] = useState<{ photos: MatchedPhoto[]; index: number } | null>(null);
  const [lightboxFullLoaded, setLightboxFullLoaded] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewSelections, setReviewSelections] = useState<string[]>([]);
  const [matchThresholds, setMatchThresholds] = useState<{ strong: number; possible: number }>({
    strong: FACE_CONFIG.strongMatchThreshold,
    possible: FACE_CONFIG.possibleMatchThreshold,
  });

  // Mobile Touch Swipe Gesture Tracking
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [touchDeltaY, setTouchDeltaY] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const faceApiPromiseRef = useRef<Promise<typeof import("face-api.js")> | null>(null);

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
    let mounted = true;

    async function checkSession() {
      try {
        const matchResp = await fetch("/api/guest/my-photos", { cache: "no-store" });
        if (!mounted || !matchResp.ok) return;

        const data = (await matchResp.json()) as MatchResponse;
        if (data.guest?.name) {
          setGuestName(data.guest.name);

          if (data.photos && data.photos.length > 0) {
            setMatchedPhotos(data.photos);
            setIsReturningGuest(true);
            if (data.source) setMatchSource(data.source);
            if (data.thresholds) setMatchThresholds(data.thresholds);
            setStep("results");
          } else {
            setIsReturningGuest(true);
            setStep("consent");
          }
        }
      } catch {
        // Guest session missing or invalid
      }
    }

    void checkSession();

    return () => {
      mounted = false;
      stopCamera();
    };
  }, []);

  async function requestOtp(e: FormEvent) {
    e.preventDefault();
    setError("");
    setStatus("");

    if (!name.trim() || !email.trim()) {
      setError("Please provide your name and email.");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/guest/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, email, phone }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to request OTP");
      }

      setOtpSent(true);
      setStatus("Passcode sent to your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request OTP");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setError("");
    setStatus("");

    if (!otp.trim()) {
      setError("Enter the passcode.");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/guest/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, name, phone, otp: otp.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Invalid passcode");
      }

      if (data.name) {
        setGuestName(data.name);
      }

      if (data.hasFaceDescriptor) {
        setIsReturningGuest(true);
        setStatus("Loading your matched photos...");
        await loadMatchedPhotos({ source: "selfie" });
      } else {
        setStep("consent");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      setError("Camera access is blocked or unavailable. Try uploading a face photo instead.");
    }
  }

  async function getFaceApi() {
    if (!faceApiPromiseRef.current) {
      faceApiPromiseRef.current = import("face-api.js").then(async (faceapi) => {
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
          faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
          faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
        ]);
        return faceapi;
      });
    }
    return faceApiPromiseRef.current;
  }

  async function scanAndMatch() {
    if (!videoRef.current || !cameraReady) return;
    setBusy(true);
    setError("");
    setStatus("Analyzing face...");

    try {
      // 1. Capture instant video frame Base64
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      }
      const imageB64 = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];

      stopCamera();

      // 2. Native Python Face Recognition backend (Instant 1-Click Search)
      if (FACE_CONFIG.enrollmentBackend !== "browser" && imageB64) {
        try {
          const recogRes = await fetch("/api/recognize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event_id: token, image_b64: imageB64 }),
          });
          if (recogRes.ok) {
            const recogData = await recogRes.json();
            const nativePhotoIds = Array.from(
              new Set([...(recogData.definite || []), ...(recogData.possible || [])])
            );
            await fetch("/api/guest/enroll-face", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ nativePhotoIds }),
            });
            await loadMatchedPhotos({ source: "selfie" });
            return;
          }
        } catch {
          /* Fallback to browser face-api */
        }
      }

      // 3. Browser face-api backend (Single-frame detection)
      const faceapi = await getFaceApi();
      const detection = await faceapi
        .detectSingleFace(
          canvas as any,
          new faceapi.SsdMobilenetv1Options({ minConfidence: FACE_CONFIG.detectionMinConfidence })
        )
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        throw new Error("No face was detected. Please center your face inside the oval guide and try again.");
      }

      const enrollRes = await fetch("/api/guest/enroll-face", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptor: Array.from(detection.descriptor) }),
      });

      if (!enrollRes.ok) {
        const errData = await enrollRes.json();
        throw new Error(errData.error || "Failed to save face profile.");
      }

      await loadMatchedPhotos({ source: "selfie" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Face scan failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadSelection(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError("");
    setStatus("Analyzing face photo...");

    try {
      if (FACE_CONFIG.enrollmentBackend !== "browser") {
        const base64String = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const recogRes = await fetch("/api/recognize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_id: token, image_b64: base64String }),
        });

        if (recogRes.ok) {
          const recogData = await recogRes.json();
          const nativePhotoIds = Array.from(
            new Set([...(recogData.definite || []), ...(recogData.possible || [])])
          );
          await fetch("/api/guest/enroll-face", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nativePhotoIds }),
          });
          stopCamera();
          await loadMatchedPhotos({ source: "selfie" });
          return;
        }
      }

      const faceapi = await getFaceApi();
      const img = await faceapi.bufferToImage(file);

      const detections = await faceapi
        .detectAllFaces(
          img,
          new faceapi.SsdMobilenetv1Options({ minConfidence: FACE_CONFIG.detectionMinConfidence })
        )
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (detections.length === 0) {
        throw new Error("No face was detected in this photo. Please upload a clear photo of your face.");
      }

      if (detections.length > 1) {
        throw new Error(
          `Found ${detections.length} faces in this photo. Please upload a photo with only your face visible.`
        );
      }

      const descriptor = detections[0].descriptor;
      stopCamera();

      setStatus("Enrolling face profile...");
      const enrollRes = await fetch("/api/guest/enroll-face", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptor: Array.from(descriptor) }),
      });

      if (!enrollRes.ok) {
        const errData = await enrollRes.json();
        throw new Error(errData.error || "Failed to save face profile.");
      }

      await loadMatchedPhotos({ source: "selfie" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process uploaded face photo.");
    } finally {
      setBusy(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function loadMatchedPhotos(opts?: { source: MatchSource; photoIds?: string[] }) {
    const source = opts?.source || "selfie";
    setStatus("Matching photos...");

    let res: Response;
    if (source === "refined" && opts?.photoIds?.length) {
      res = await fetch("/api/guest/my-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: opts.photoIds }),
      });
    } else {
      res = await fetch("/api/guest/my-photos", { cache: "no-store" });
    }

    if (!res.ok) throw new Error("Failed to load matches.");

    const data = (await res.json()) as MatchResponse;
    const photos = data.photos || [];
    setMatchedPhotos(photos);
    setMatchSource(data.source || source);
    if (data.thresholds) setMatchThresholds(data.thresholds);

    if (source === "selfie" && photos.length > 0 && !isReturningGuest) {
      const sortedCandidates = [...photos].sort((a, b) => {
        const countA = a.faceCount ?? 1;
        const countB = b.faceCount ?? 1;
        if (countA === 1 && countB !== 1) return -1;
        if (countA !== 1 && countB === 1) return 1;
        return b.score - a.score;
      });

      setMatchedPhotos(sortedCandidates);
      setReviewIndex(0);
      setReviewSelections([]);
      setStep("review");
    } else {
      setStep("results");
    }

    setStatus("");
  }

  function handleReviewChoice(isMe: boolean) {
    const currentPhoto = matchedPhotos[reviewIndex];
    let nextSelections = [...reviewSelections];

    if (isMe && currentPhoto) {
      nextSelections.push(currentPhoto.id);
      setReviewSelections(nextSelections);
    }

    const nextIndex = reviewIndex + 1;
    const maxReview = Math.min(5, matchedPhotos.length);

    if (nextIndex < maxReview) {
      setReviewIndex(nextIndex);
    } else {
      setBusy(true);
      setStatus("Refining search based on your selections...");

      if (nextSelections.length > 0) {
        loadMatchedPhotos({ source: "refined", photoIds: nextSelections })
          .catch(() => setStep("results"))
          .finally(() => setBusy(false));
      } else {
        setStep("results");
        setBusy(false);
      }
    }
  }

  function toggleConfirmedPhoto(photoId: string) {
    setConfirmedPhotoIds((prev) => {
      if (prev.includes(photoId)) {
        return prev.filter((id) => id !== photoId);
      }
      if (prev.length >= 3) {
        setError("You can select up to 3 photos to refine the search.");
        return prev;
      }
      setError("");
      return [...prev, photoId];
    });
  }

  async function refineMatches() {
    if (!confirmedPhotoIds.length) return;
    setBusy(true);
    setError("");

    try {
      await loadMatchedPhotos({ source: "refined", photoIds: confirmedPhotoIds });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refine search.");
    } finally {
      setBusy(false);
    }
  }

  function rescanFace() {
    setConfirmedPhotoIds([]);
    setError("");
    setStatus("");
    setStep("scan");
    void startCamera();
  }

  // Mobile Touch Swipe Handlers for Lightbox
  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
      setTouchDeltaY(0);
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!touchStartRef.current || e.touches.length !== 1) return;
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;
    if (deltaY > 0) {
      setTouchDeltaY(deltaY);
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!touchStartRef.current || !lightbox) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;

    touchStartRef.current = null;
    setTouchDeltaY(0);

    // Swipe Down to Dismiss Lightbox (vertical downward displacement > 80px)
    if (deltaY > 80 && Math.abs(deltaY) > Math.abs(deltaX)) {
      setLightbox(null);
      return;
    }

    // Horizontal Swipe (Left = Next, Right = Prev)
    if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) && elapsed < 500) {
      if (deltaX < 0 && lightbox.index < lightbox.photos.length - 1) {
        setLightbox((lb) => lb && { ...lb, index: lb.index + 1 });
      } else if (deltaX > 0 && lightbox.index > 0) {
        setLightbox((lb) => lb && { ...lb, index: lb.index - 1 });
      }
    }
  }

  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight")
        setLightbox((lb) => lb && { ...lb, index: Math.min(lb.index + 1, lb.photos.length - 1) });
      if (e.key === "ArrowLeft")
        setLightbox((lb) => lb && { ...lb, index: Math.max(lb.index - 1, 0) });
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

    fetch("/api/guest/log-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "download_started",
        payload: { count: matchedPhotos.length, source: "matched_zip" },
      }),
    }).catch(console.error);
  }

  function downloadPhoto(photo: MatchedPhoto) {
    const link = document.createElement("a");
    link.href = photo.originalUrl || photo.url;
    link.download = photo.originalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    fetch("/api/guest/log-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "download_started",
        payload: { count: 1, source: "single_photo" },
      }),
    }).catch(console.error);
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
              <button
                className="btn-gold"
                onClick={() => {
                  setStep("scan");
                  void startCamera();
                }}
              >
                I consent, scan my face
              </button>
              <Link href={`/share/${token}`} className="btn-ghost">
                Browse all photos instead
              </Link>
            </div>
          </div>
        )}

        {step === "scan" && (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                width: "100%",
                maxWidth: 420,
                position: "relative",
                borderRadius: 24,
                overflow: "hidden",
                background: "#0c0a09",
                boxShadow: "0 24px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(212, 175, 55, 0.25)",
              }}
            >
              {/* Live Mirrored Front Camera Feed */}
              <video
                ref={videoRef}
                muted
                playsInline
                style={{
                  width: "100%",
                  height: 460,
                  objectFit: "cover",
                  transform: "scaleX(-1)",
                  display: "block",
                }}
              />

              {/* Centered SVG Face Oval Viewfinder Overlay */}
              <svg
                viewBox="0 0 100 100"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                }}
              >
                <defs>
                  <mask id="faceOvalMask">
                    <rect width="100" height="100" fill="white" />
                    <ellipse cx="50" cy="44" rx="28" ry="36" fill="black" />
                  </mask>
                  <linearGradient id="goldRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f59e0b" />
                    <stop offset="50%" stopColor="#fbbf24" />
                    <stop offset="100%" stopColor="#d97706" />
                  </linearGradient>
                </defs>
                <rect width="100" height="100" fill="rgba(0,0,0,0.55)" mask="url(#faceOvalMask)" />
                <ellipse
                  cx="50"
                  cy="44"
                  rx="28"
                  ry="36"
                  fill="none"
                  stroke="url(#goldRingGrad)"
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                  style={{ filter: "drop-shadow(0 0 6px rgba(245, 158, 11, 0.7))" }}
                />
              </svg>

              {/* Status Header Badge */}
              <div
                style={{
                  position: "absolute",
                  top: 16,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "rgba(0, 0, 0, 0.65)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  padding: "6px 16px",
                  borderRadius: 20,
                  color: "#f3f4f6",
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                  pointerEvents: "none",
                }}
              >
                {busy ? status || "Analyzing face..." : "Align face inside oval"}
              </div>

              {/* Bottom Glassmorphism Control Deck */}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: "20px 24px 24px",
                  background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 75%, transparent 100%)",
                  backdropFilter: "blur(8px)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                {/* Upload File Fallback Button */}
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={busy}
                  title="Upload photo instead"
                  style={{
                    background: "rgba(255, 255, 255, 0.12)",
                    border: "1px solid rgba(255, 255, 255, 0.2)",
                    color: "#fff",
                    borderRadius: "50%",
                    width: 44,
                    height: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </button>

                {/* Tactical 1-Click Shutter Button */}
                <button
                  onClick={scanAndMatch}
                  disabled={busy || !cameraReady}
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: "50%",
                    border: "3px solid #f59e0b",
                    background: "rgba(245, 158, 11, 0.2)",
                    boxShadow: "0 0 20px rgba(245, 158, 11, 0.4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: busy || !cameraReady ? "not-allowed" : "pointer",
                    padding: 0,
                    transition: "transform 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: "50%",
                      background: busy ? "#9ca3af" : "#f59e0b",
                      transition: "background 0.2s ease",
                    }}
                  />
                </button>

                {/* Cancel / Browse All Button */}
                <Link
                  href={`/share/${token}`}
                  title="Browse all photos"
                  style={{
                    background: "rgba(255, 255, 255, 0.12)",
                    border: "1px solid rgba(255, 255, 255, 0.2)",
                    color: "#fff",
                    borderRadius: "50%",
                    width: 44,
                    height: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textDecoration: "none",
                  }}
                >
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </Link>
              </div>
            </div>

            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              onChange={handleUploadSelection}
              style={{ display: "none" }}
            />
            <p style={{ marginTop: 14, fontSize: 13, color: "var(--brown)", textAlign: "center" }}>
              Tap the shutter button or upload a photo to find your photos instantly.
            </p>
          </div>
        )}

        {step === "review" && (
          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--espresso)", textAlign: "center" }}>
              Quick Review
            </h2>
            <p style={{ marginTop: 6, fontSize: 14, color: "var(--brown)", textAlign: "center", maxWidth: 460 }}>
              Help FotoHaven learn exactly what you look like today. Are you in this photo? ({reviewIndex + 1} of {Math.min(5, matchedPhotos.length)})
            </p>

            {matchedPhotos[reviewIndex] && (
              <div style={{ marginTop: 24, width: "100%", maxWidth: 360, borderRadius: 12, overflow: "hidden", background: "#000", position: "relative" }}>
                <img
                  src={matchedPhotos[reviewIndex].url}
                  alt="Review candidate"
                  style={{ width: "100%", height: 360, objectFit: "cover", display: "block" }}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap", justifyContent: "center", width: "100%", maxWidth: 360 }}>
              <button
                className="btn-ghost"
                style={{ flex: 1, padding: "14px 10px", fontSize: 15 }}
                onClick={() => handleReviewChoice(false)}
                disabled={busy}
              >
                No, not me
              </button>
              <button
                className="btn-gold"
                style={{ flex: 1, padding: "14px 10px", fontSize: 15 }}
                onClick={() => handleReviewChoice(true)}
                disabled={busy}
              >
                Yes, that's me
              </button>
            </div>

            <button
              className="btn-ghost"
              style={{ marginTop: 24, fontSize: 13, border: "none" }}
              onClick={async () => {
                if (reviewSelections.length > 0) {
                  setBusy(true);
                  setStatus("Finding more photos based on your review...");
                  try {
                    await loadMatchedPhotos({ source: "refined", photoIds: reviewSelections });
                  } catch {
                    setStep("results");
                  } finally {
                    setBusy(false);
                  }
                } else {
                  setStep("results");
                }
              }}
              disabled={busy}
            >
              Skip the rest
            </button>
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
                <p style={{ marginTop: 8, fontSize: 14, color: "var(--brown)" }}>
                  Missing some photos? Tap up to 3 photos of yourself to improve the search.
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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

            {/* View Mode Switcher Toolbar */}
            {matchedPhotos.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 20, marginBottom: 16, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--warm-white)", padding: 4, borderRadius: 8, border: "1px solid var(--sand)" }}>
                  <button
                    type="button"
                    onClick={() => setViewMode("grid")}
                    className={viewMode === "grid" ? "btn-gold" : "btn-ghost"}
                    style={{ padding: "6px 12px", fontSize: 12, gap: 6, borderRadius: 6 }}
                    title="1:1 Square Grid View"
                  >
                    <LayoutGrid size={14} />
                    <span>Grid</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("masonry")}
                    className={viewMode === "masonry" ? "btn-gold" : "btn-ghost"}
                    style={{ padding: "6px 12px", fontSize: 12, gap: 6, borderRadius: 6 }}
                    title="Masonry Composition View"
                  >
                    <Columns size={14} />
                    <span>Masonry</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("single")}
                    className={viewMode === "single" ? "btn-gold" : "btn-ghost"}
                    style={{ padding: "6px 12px", fontSize: 12, gap: 6, borderRadius: 6 }}
                    title="Single Card Focus View"
                  >
                    <Square size={14} />
                    <span>Focus</span>
                  </button>
                </div>
              </div>
            )}

            {matchedPhotos.length === 0 ? (
              <p style={{ marginTop: 14, color: "var(--brown)", fontSize: 14 }}>
                No strong matches found yet. You can browse all photos instead or rescan your face.
              </p>
            ) : viewMode === "single" ? (
              /* Single Card Focus View Mode */
              <div style={{ display: "flex", flexDirection: "column", gap: 24, alignItems: "center", marginTop: 16 }}>
                {matchedPhotos.map((photo, index) => {
                  const selected = confirmedPhotoIds.includes(photo.id);
                  return (
                    <div
                      key={photo.id}
                      style={{
                        width: "100%",
                        maxWidth: 560,
                        borderRadius: 14,
                        overflow: "hidden",
                        background: "var(--sand)",
                        border: selected ? "3px solid #C4A86C" : "1px solid var(--sand)",
                        boxShadow: selected ? "0 0 0 3px rgba(196, 168, 108, 0.85)" : "0 4px 16px rgba(0,0,0,0.06)",
                        position: "relative",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleConfirmedPhoto(photo.id)}
                        style={{ position: "relative", display: "block", width: "100%", border: "none", padding: 0, background: "transparent", cursor: "pointer" }}
                      >
                        <img
                          src={photo.url}
                          alt={photo.originalName}
                          style={{
                            width: "100%",
                            maxHeight: 500,
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      </button>

                      <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff" }}>
                        <div>
                          <span
                            style={{
                              background:
                                photo.score >= matchThresholds.strong
                                  ? "rgba(34,197,94,0.88)"
                                  : "rgba(234,179,8,0.88)",
                              color: "#fff",
                              borderRadius: 4,
                              padding: "3px 8px",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {photo.score >= matchThresholds.strong ? "Strong match" : "Possible match"}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => downloadPhoto(photo)}
                            style={{ padding: "6px 12px", fontSize: 13, gap: 6 }}
                          >
                            <Download size={14} />
                            Download
                          </button>
                          <button
                            type="button"
                            className="btn-gold"
                            onClick={() => setLightbox({ photos: matchedPhotos, index })}
                            style={{ padding: "6px 12px", fontSize: 13, gap: 6 }}
                          >
                            <Maximize size={14} />
                            Expand
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : viewMode === "masonry" ? (
              /* Masonry Composition View Mode */
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
                  gap: 16,
                  marginTop: 16,
                }}
              >
                {matchedPhotos.map((photo, index) => {
                  const selected = confirmedPhotoIds.includes(photo.id);
                  return (
                    <div
                      key={photo.id}
                      style={{
                        position: "relative",
                        borderRadius: 12,
                        overflow: "hidden",
                        background: "var(--sand)",
                        border: selected ? "3px solid #C4A86C" : "1px solid var(--sand)",
                        boxShadow: selected ? "0 0 0 3px rgba(196, 168, 108, 0.85)" : undefined,
                        transition: "all 0.2s ease",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleConfirmedPhoto(photo.id)}
                        style={{ position: "relative", background: "transparent", display: "block", width: "100%", padding: 0, border: "none", cursor: "pointer" }}
                      >
                        <img
                          src={photo.url}
                          alt={photo.originalName}
                          style={{
                            width: "100%",
                            maxHeight: 380,
                            objectFit: "cover",
                            display: "block",
                            transform: selected ? "scale(0.95)" : "scale(1)",
                            transition: "transform 0.2s ease",
                          }}
                        />
                        <span
                          style={{
                            position: "absolute",
                            bottom: 8,
                            left: 8,
                            background:
                              photo.score >= matchThresholds.strong
                                ? "rgba(34,197,94,0.88)"
                                : "rgba(234,179,8,0.88)",
                            color: "#fff",
                            borderRadius: 4,
                            padding: "2px 7px",
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          {photo.score >= matchThresholds.strong ? "Strong match" : "Possible match"}
                        </span>
                      </button>
                      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadPhoto(photo);
                          }}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            border: "none",
                            background: "rgba(26,18,8,0.6)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            backdropFilter: "blur(6px)",
                          }}
                          title="Download photo"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightbox({ photos: matchedPhotos, index });
                          }}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            border: selected ? "none" : "1px solid rgba(255,255,255,0.9)",
                            background: selected ? "rgba(196, 168, 108, 0.96)" : "rgba(26,18,8,0.6)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            backdropFilter: "blur(6px)",
                          }}
                          aria-label="View large photo"
                        >
                          {selected ? <Check size={16} /> : <Maximize size={14} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Grid View Mode (Default 1:1) */
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
                        border: selected ? "3px solid #C4A86C" : "3px solid transparent",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleConfirmedPhoto(photo.id)}
                        style={{ position: "relative", background: "transparent", display: "block", width: "100%", padding: 0, border: "none", cursor: "pointer" }}
                      >
                        <img
                          src={photo.url}
                          alt={photo.originalName}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            aspectRatio: "1 / 1",
                            transform: selected ? "scale(0.92)" : "scale(1)",
                            transition: "transform 0.2s ease",
                          }}
                        />
                        <span
                          style={{
                            position: "absolute",
                            bottom: 6,
                            left: 6,
                            background:
                              photo.score >= matchThresholds.strong
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
                          {photo.score >= matchThresholds.strong ? "Strong match" : "Possible match"}
                        </span>
                      </button>
                      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadPhoto(photo);
                          }}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            border: "none",
                            background: "rgba(26,18,8,0.6)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            backdropFilter: "blur(6px)",
                          }}
                          title="Download photo"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightbox({ photos: matchedPhotos, index });
                          }}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            border: selected ? "none" : "1px solid rgba(255,255,255,0.9)",
                            background: selected ? "rgba(196, 168, 108, 0.96)" : "rgba(26,18,8,0.6)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            backdropFilter: "blur(6px)",
                          }}
                          aria-label="View large photo"
                        >
                          {selected ? <Check size={16} /> : <Maximize size={14} />}
                        </button>
                      </div>
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

      {confirmedPhotoIds.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "16px",
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(12px)",
            borderTop: "1px solid rgba(0,0,0,0.08)",
            boxShadow: "0 -4px 12px rgba(0,0,0,0.05)",
            display: "flex",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 980,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--espresso)" }}>
              {confirmedPhotoIds.length} photo{confirmedPhotoIds.length !== 1 ? "s" : ""} selected
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfirmedPhotoIds([])}
                style={{ fontSize: 13 }}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn-gold"
                onClick={refineMatches}
                disabled={busy}
              >
                {busy && matchSource === "refined" ? "Refining..." : "Find Better Matches"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox with Native Mobile Touch Swipe Gestures */}
      {lightbox && (
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(26,18,8,0.95)",
            zIndex: 1000,
            display: "flex",
            transform: `translateY(${touchDeltaY}px)`,
            opacity: touchDeltaY > 0 ? Math.max(0.3, 1 - touchDeltaY / 300) : 1,
            transition: touchDeltaY === 0 ? "transform 0.25s ease, opacity 0.25s ease" : "none",
          }}
          onClick={() => setLightbox(null)}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              padding: "40px",
            }}
          >
            <div style={{ position: "absolute", top: 20, right: 20, display: "flex", gap: 8, zIndex: 10 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  downloadPhoto(lightbox.photos[lightbox.index]);
                }}
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  borderRadius: 999,
                  minWidth: 40,
                  height: 40,
                  padding: "0 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#fff",
                  gap: 8,
                }}
              >
                <Download size={16} />
                <span style={{ fontSize: 12 }}>Download</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox(null);
                }}
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  borderRadius: "50%",
                  width: 40,
                  height: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#fff",
                }}
              >
                <X size={18} />
              </button>
            </div>

            {lightbox.index > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox((lb) => lb && { ...lb, index: lb.index - 1 });
                }}
                style={{
                  position: "absolute",
                  left: 20,
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  borderRadius: "50%",
                  width: 44,
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#fff",
                  zIndex: 10,
                }}
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
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox((lb) => lb && { ...lb, index: lb.index + 1 });
                }}
                style={{
                  position: "absolute",
                  right: 20,
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  borderRadius: "50%",
                  width: 44,
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#fff",
                  zIndex: 10,
                }}
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
