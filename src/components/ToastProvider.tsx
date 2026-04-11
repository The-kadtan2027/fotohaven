"use client";
// src/components/ToastProvider.tsx
// Zero-npm in-app toast / confirm / prompt system.
// Replaces window.alert(), window.confirm(), window.prompt() across FotoHaven.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
}

interface PromptState {
  message: string;
  placeholder?: string;
  resolve: (value: string | null) => void;
}

interface ToastContextValue {
  /** Show an auto-dismissing notification. */
  toast: (message: string, type?: ToastType) => void;
  /** Show an in-app confirm dialog. Returns true if confirmed. */
  confirm: (message: string) => Promise<boolean>;
  /** Show an in-app prompt dialog. Returns the entered string or null if cancelled. */
  prompt: (message: string, placeholder?: string) => Promise<string | null>;
}

// ── Context ────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const nextId = useRef(0);
  const promptInputRef = useRef<HTMLInputElement>(null);

  // ── toast() ──────────────────────────────────────────────────────────────

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  // ── confirm() ─────────────────────────────────────────────────────────────

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ message, resolve });
    });
  }, []);

  const handleConfirm = (value: boolean) => {
    confirmState?.resolve(value);
    setConfirmState(null);
  };

  // ── prompt() ──────────────────────────────────────────────────────────────

  const prompt = useCallback(
    (message: string, placeholder?: string): Promise<string | null> => {
      setPromptValue("");
      return new Promise((resolve) => {
        setPromptState({ message, placeholder, resolve });
        // Focus input on next frame
        setTimeout(() => promptInputRef.current?.focus(), 50);
      });
    },
    []
  );

  const handlePromit = (submit: boolean) => {
    promptState?.resolve(submit ? promptValue : null);
    setPromptState(null);
    setPromptValue("");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const iconFor = (type: ToastType) => {
    if (type === "success") return "✓";
    if (type === "error") return "✕";
    return "ℹ";
  };

  const colorFor = (type: ToastType) => {
    if (type === "success") return "var(--sage, #5a8a5a)";
    if (type === "error") return "var(--blush, #c0392b)";
    return "var(--gold)";
  };

  return (
    <ToastContext.Provider value={{ toast, confirm, prompt }}>
      {children}

      {/* ── Toast stack ── */}
      <div
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          pointerEvents: "none",
          maxWidth: "calc(100vw - 40px)",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--espresso, #1a1208)",
              color: "#faf7f2",
              padding: "13px 18px",
              borderRadius: 12,
              boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
              fontSize: 14,
              fontFamily: "var(--font-body, inherit)",
              borderLeft: `4px solid ${colorFor(t.type)}`,
              animation: "toastSlideIn 0.28s cubic-bezier(0.34,1.56,0.64,1) both",
              pointerEvents: "auto",
              maxWidth: 380,
              wordBreak: "break-word",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: colorFor(t.type),
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {iconFor(t.type)}
            </span>
            <span style={{ flex: 1 }}>{t.message}</span>
          </div>
        ))}
      </div>

      {/* ── Confirm modal ── */}
      {confirmState && (
        <ModalOverlay onBackdropClick={() => handleConfirm(false)}>
          <div style={modalCard}>
            <p style={modalMessage}>{confirmState.message}</p>
            <div style={modalActions}>
              <button
                style={modalBtn("ghost")}
                onClick={() => handleConfirm(false)}
                autoFocus
              >
                Cancel
              </button>
              <button
                style={modalBtn("danger")}
                onClick={() => handleConfirm(true)}
              >
                Confirm
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Prompt modal ── */}
      {promptState && (
        <ModalOverlay onBackdropClick={() => handlePromit(false)}>
          <div style={modalCard}>
            <p style={modalMessage}>{promptState.message}</p>
            <input
              ref={promptInputRef}
              type="text"
              value={promptValue}
              placeholder={promptState.placeholder ?? ""}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePromit(true);
                if (e.key === "Escape") handlePromit(false);
              }}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1.5px solid var(--sand, #ddd)",
                background: "var(--warm-white, #faf7f2)",
                fontSize: 14,
                fontFamily: "inherit",
                color: "var(--espresso, #1a1208)",
                marginBottom: 16,
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            <div style={modalActions}>
              <button
                style={modalBtn("ghost")}
                onClick={() => handlePromit(false)}
              >
                Cancel
              </button>
              <button
                style={modalBtn("primary")}
                onClick={() => handlePromit(true)}
                disabled={!promptValue.trim()}
              >
                OK
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Keyframe for toast slide-in */}
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(40px) scale(0.95); }
          to   { opacity: 1; transform: translateX(0)    scale(1); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

// ── Small helper components ────────────────────────────────────────────────

function ModalOverlay({
  children,
  onBackdropClick,
}: {
  children: React.ReactNode;
  onBackdropClick: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,18,8,0.72)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backdropFilter: "blur(4px)",
        animation: "fadeIn 0.15s ease both",
      }}
      onClick={onBackdropClick}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const modalCard: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  padding: "28px 28px 24px",
  maxWidth: 420,
  width: "100%",
  boxShadow: "0 24px 80px rgba(0,0,0,0.3)",
  animation: "modalPop 0.22s cubic-bezier(0.34,1.56,0.64,1) both",
};

const modalMessage: React.CSSProperties = {
  fontSize: 15,
  color: "var(--espresso, #1a1208)",
  lineHeight: 1.55,
  marginBottom: 24,
  fontFamily: "var(--font-body, inherit)",
};

const modalActions: React.CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
};

function modalBtn(variant: "ghost" | "danger" | "primary"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "9px 22px",
    borderRadius: 8,
    border: "none",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "var(--font-body, inherit)",
    transition: "all 0.15s",
  };
  if (variant === "ghost") return { ...base, background: "var(--warm-white, #f5f0e8)", color: "var(--brown, #5c4a3a)", border: "1px solid var(--sand, #ddd)" };
  if (variant === "danger") return { ...base, background: "var(--blush, #c0392b)", color: "#fff" };
  return { ...base, background: "var(--espresso, #1a1208)", color: "#fff" };
}
