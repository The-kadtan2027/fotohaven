"use client";
// src/app/albums/new/page.tsx
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, X, ChevronRight, Check } from "lucide-react";

const SUGGESTED_CEREMONIES = [
  "Haldi", "Mehndi", "Sangeet", "Wedding", "Reception",
  "Engagement", "Pre-Wedding Shoot", "Post-Wedding",
];

export default function NewAlbumPage() {
  const router = useRouter();
  const [step, setStep] = useState(1); // 1: details, 2: ceremonies, 3: settings
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [ceremonies, setCeremonies] = useState<string[]>([]);
  const [customCeremony, setCustomCeremony] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const addCeremony = (name: string) => {
    if (!name.trim() || ceremonies.includes(name.trim())) return;
    setCeremonies((prev) => [...prev, name.trim()]);
    setCustomCeremony("");
  };

  const removeCeremony = (name: string) =>
    setCeremonies((prev) => prev.filter((c) => c !== name));

  const handleSubmit = async () => {
    if (!title || !clientName || ceremonies.length === 0) {
      setError("Please complete all required fields.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, clientName, ceremonies, expiresAt: expiresAt || null }),
      });
      if (!res.ok) throw new Error("Failed to create album");
      const album = await res.json();
      router.push(`/albums/${album.id}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  // Min date = today for expiry picker
  const today = new Date().toISOString().split("T")[0];

  return (
    <div style={{ minHeight: "100vh", background: "var(--cream)", padding: "0 24px" }}>
      {/* Header */}
      <div style={{ maxWidth: 640, margin: "0 auto", paddingTop: 32, paddingBottom: 48 }}>
        <Link href="/" className="btn-ghost" style={{ textDecoration: "none", display: "inline-flex", marginBottom: 40, fontSize: 13 }}>
          <ArrowLeft size={14} />
          Back to Albums
        </Link>

        {/* Step indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 40 }}>
          {[
            { n: 1, label: "Details" },
            { n: 2, label: "Ceremonies" },
            { n: 3, label: "Settings" },
          ].map(({ n, label }, i) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {i > 0 && <div style={{ width: 32, height: 1, background: step > i ? "var(--gold)" : "var(--sand)" }} />}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500,
                  background: step > n ? "var(--gold)" : step === n ? "var(--espresso)" : "var(--warm-white)",
                  color: step >= n ? "#fff" : "var(--taupe)",
                  border: step < n ? "1px solid var(--sand)" : "none",
                  transition: "all 0.3s ease",
                }}>
                  {step > n ? <Check size={12} /> : n}
                </div>
                <span style={{ fontSize: 13, color: step === n ? "var(--espresso)" : "var(--taupe)", fontWeight: step === n ? 500 : 400 }}>
                  {label}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 36 }}>
          {/* Step 1: Album details */}
          {step === 1 && (
            <div className="animate-fade-up">
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: 32, color: "var(--espresso)", marginBottom: 6 }}>
                Album Details
              </h1>
              <p style={{ color: "var(--brown)", fontSize: 14, marginBottom: 32 }}>
                Name this album and tell us who it's for.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div>
                  <label style={labelStyle}>Album Title</label>
                  <input
                    className="input"
                    placeholder="e.g. Sharma Wedding 2024"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <label style={labelStyle}>Photographer's Name</label>
                  <input
                    className="input"
                    placeholder="e.g. Rahul Mehta Photography"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ marginTop: 32, display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="btn-primary"
                  onClick={() => { if (title && clientName) setStep(2); else setError("Please fill both fields."); }}
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Ceremonies */}
          {step === 2 && (
            <div className="animate-fade-up">
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: 32, color: "var(--espresso)", marginBottom: 6 }}>
                Ceremony Folders
              </h1>
              <p style={{ color: "var(--brown)", fontSize: 14, marginBottom: 28 }}>
                Add each ceremony as a folder. Photos will be organised inside these.
              </p>

              {/* Suggestions */}
              <div style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 12, color: "var(--taupe)", marginBottom: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Quick Add
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {SUGGESTED_CEREMONIES.filter((s) => !ceremonies.includes(s)).map((name) => (
                    <button
                      key={name}
                      className="tag"
                      style={{ cursor: "pointer", border: "1px dashed var(--taupe)" }}
                      onClick={() => addCeremony(name)}
                    >
                      <Plus size={10} style={{ marginRight: 2 }} />
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom ceremony input */}
              <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                <input
                  className="input"
                  placeholder="Custom ceremony name..."
                  value={customCeremony}
                  onChange={(e) => setCustomCeremony(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCeremony(customCeremony)}
                  style={{ flex: 1 }}
                />
                <button className="btn-ghost" onClick={() => addCeremony(customCeremony)}>
                  Add
                </button>
              </div>

              {/* Selected ceremonies */}
              {ceremonies.length > 0 && (
                <div style={{ background: "var(--warm-white)", borderRadius: 12, padding: 16, marginBottom: 8 }}>
                  <p style={{ fontSize: 12, color: "var(--taupe)", marginBottom: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                    Selected ({ceremonies.length})
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {ceremonies.map((c, i) => (
                      <div key={c} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid var(--sand)" }}>
                        <span style={{ fontSize: 14, color: "var(--espresso)", display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: "var(--taupe)", fontWeight: 500, minWidth: 16 }}>{i + 1}</span>
                          {c}
                        </span>
                        <button onClick={() => removeCeremony(c)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--taupe)", padding: 4, display: "flex" }}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 32, display: "flex", justifyContent: "space-between" }}>
                <button className="btn-ghost" onClick={() => setStep(1)}>
                  <ArrowLeft size={14} />
                  Back
                </button>
                <button
                  className="btn-primary"
                  onClick={() => { if (ceremonies.length > 0) setStep(3); else setError("Add at least one ceremony."); }}
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Settings */}
          {step === 3 && (
            <div className="animate-fade-up">
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: 32, color: "var(--espresso)", marginBottom: 6 }}>
                Link Settings
              </h1>
              <p style={{ color: "var(--brown)", fontSize: 14, marginBottom: 32 }}>
                Optional settings for your share link.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 32 }}>
                <div>
                  <label style={labelStyle}>
                    Link Expiry
                    <span style={{ color: "var(--taupe)", fontWeight: 400 }}> — optional</span>
                  </label>
                  <input
                    className="input"
                    type="date"
                    min={today}
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                  <p style={{ fontSize: 12, color: "var(--taupe)", marginTop: 4 }}>
                    After this date, the share link will stop working.
                  </p>
                </div>
              </div>

              {/* Summary */}
              <div style={{ background: "var(--warm-white)", borderRadius: 12, padding: 20, marginBottom: 28 }}>
                <p style={{ fontSize: 12, color: "var(--taupe)", marginBottom: 12, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Summary
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Row label="Album" value={title} />
                  <Row label="Photographer" value={clientName} />
                  <Row label="Ceremonies" value={ceremonies.join(", ")} />
                  {expiresAt && <Row label="Expires" value={new Date(expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} />}
                </div>
              </div>

              {error && (
                <p style={{ color: "var(--blush)", fontSize: 13, marginBottom: 16 }}>{error}</p>
              )}

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button className="btn-ghost" onClick={() => setStep(2)}>
                  <ArrowLeft size={14} />
                  Back
                </button>
                <button className="btn-gold" onClick={handleSubmit} disabled={loading}>
                  {loading ? "Creating…" : "Create Album →"}
                </button>
              </div>
            </div>
          )}

          {/* Inline error for steps 1-2 */}
          {error && step < 3 && (
            <p style={{ color: "var(--blush)", fontSize: 13, marginTop: 12 }}>{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--espresso)",
  marginBottom: 6,
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
      <span style={{ color: "var(--taupe)", minWidth: 100 }}>{label}</span>
      <span style={{ color: "var(--espresso)", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
