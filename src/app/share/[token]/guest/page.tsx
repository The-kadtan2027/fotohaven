"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { averageDescriptors } from "@/lib/face-math";

type Photo = {
  id: string;
  originalName: string;
  url: string;
  originalUrl?: string;
};

// Extends Photo with the cosine-distance score returned by /api/guest/my-photos
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
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
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
      setStep("consent");
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

  async function scanAndMatch() {
    if (!videoRef.current) return;
    setBusy(true);
    setError("");

    try {
      // Multi-frame enrollment: capture 3 frames 500 ms apart and average the
      // descriptors. A single selfie frame is sensitive to momentary expression,
      // angle, and lighting; an average of 3 is far more stable.
      const SAMPLES = 3;
      const DELAY_MS = 500;
      const canvases: HTMLCanvasElement[] = [];

      for (let i = 0; i < SAMPLES; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
        setStatus(`Capturing sample ${i + 1} of ${SAMPLES} — hold still...`);

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

      if (collectedDescriptors.length < 2) {
        throw new Error(
          `Only ${collectedDescriptors.length} of ${SAMPLES} samples detected a face. ` +
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

      setStatus("Finding your photos...");
      const matchResp = await fetch("/api/guest/my-photos");
      const matchData = await matchResp.json();
      if (!matchResp.ok) {
        throw new Error(matchData.error || "Failed to find matches");
      }

      // New response: { photos: [{ photoId, score }] } sorted best-first
      const scored: { photoId: string; score: number }[] = matchData.photos || [];
      if (!scored.length) {
        setMatchedPhotos([]);
        setStep("results");
        setStatus("");
        return;
      }

      const albumResp = await fetch(`/api/share/${token}`);
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
    } catch (err: any) {
      setError(err.message || "Scan failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--espresso)" }}>
                Your matched photos ({matchedPhotos.length})
              </h2>
              {matchedPhotos.length > 0 && (
                <button className="btn-gold" onClick={downloadMatched}>
                  Download matched ZIP
                </button>
              )}
            </div>

            {matchedPhotos.length === 0 ? (
              <p style={{ marginTop: 14, color: "var(--brown)", fontSize: 14 }}>
                No strong matches found yet. You can browse all photos instead.
              </p>
            ) : (
              <div className="photo-grid" style={{ marginTop: 16 }}>
                {matchedPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: "var(--sand)" }}
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
                          photo.score < 0.3
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
                      {photo.score < 0.3 ? "Strong match" : "Possible match"}
                    </span>
                  </div>
                ))}
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
    </div>
  );
}
