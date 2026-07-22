"use client";

import { useEffect, useState } from "react";
import { Download, WifiOff, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstaller() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // 1. Service Worker Registration
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("[PWA] Service Worker registered:", reg.scope);
        })
        .catch((err) => {
          console.warn("[PWA] Service Worker registration failed:", err);
        });
    }

    // 2. Install Prompt Listener
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const event = e as BeforeInstallPromptEvent;
      setDeferredPrompt(event);

      const dismissed = localStorage.getItem("fotohaven_pwa_dismissed");
      if (!dismissed) {
        setShowInstallBanner(true);
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // 3. Online / Offline Network Status Listeners
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    if (typeof window !== "undefined") {
      setIsOffline(!navigator.onLine);
      window.addEventListener("offline", handleOffline);
      window.addEventListener("online", handleOnline);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    setShowInstallBanner(false);
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      console.log("[PWA] User accepted install prompt");
    }
    setDeferredPrompt(null);
  }

  function handleDismiss() {
    setShowInstallBanner(false);
    localStorage.setItem("fotohaven_pwa_dismissed", "true");
  }

  return (
    <>
      {/* Offline Status Badge */}
      {isOffline && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            background: "#1a1208",
            color: "#C4A86C",
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: 600,
            textAlign: "center",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            zIndex: 9999,
            borderBottom: "1px solid rgba(196,168,108,0.3)",
          }}
        >
          <WifiOff size={14} />
          <span>You are offline — viewing cached photos & thumbnails</span>
        </div>
      )}

      {/* PWA Install Banner */}
      {showInstallBanner && deferredPrompt && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            maxWidth: 380,
            width: "calc(100% - 40px)",
            background: "#1a1208",
            color: "#fff",
            borderRadius: 14,
            padding: 16,
            boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
            border: "1px solid rgba(196,168,108,0.3)",
            zIndex: 9000,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h4 style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "#C4A86C", margin: 0 }}>
                Install FotoHaven
              </h4>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", marginTop: 4, margin: 0 }}>
                Add to your home screen for fast, full-screen photo viewing & offline access.
              </p>
            </div>
            <button
              onClick={handleDismiss}
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.5)",
                cursor: "pointer",
                padding: 4,
              }}
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={handleDismiss}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#fff",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Later
            </button>
            <button
              onClick={handleInstallClick}
              className="btn-gold"
              style={{
                borderRadius: 8,
                padding: "6px 16px",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Download size={14} />
              Install App
            </button>
          </div>
        </div>
      )}
    </>
  );
}
