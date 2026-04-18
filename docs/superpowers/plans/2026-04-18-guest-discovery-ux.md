# Guest Discovery UX Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Find more photos like this person" feature intuitive by switching to a mobile-gallery selection style (tap to select, sticky bottom action bar).

**Architecture:** We will modify the `GuestFaceDiscoveryPage` React component. The state remains the same (`confirmedPhotoIds`), but the interaction model changes from "small checkboxes + inline banner" to "tap whole card to select + sticky bottom bar".

**Tech Stack:** Next.js React Client Components, Vanilla CSS (inline styles), Lucide React.

---

### Task 1: Update Imports and Remove Old Banner

**Files:**
- Modify: `d:\antigravity\files\fotohaven\src\app\share\[token]\guest\page.tsx:6-7`
- Modify: `d:\antigravity\files\fotohaven\src\app\share\[token]\guest\page.tsx:603-750`

- [ ] **Step 1: Update imports from lucide-react**

Update the import at the top to add `Maximize`.

```tsx
import { Check, ChevronLeft, ChevronRight, Download, Sparkles, X, Maximize } from "lucide-react";
```

- [ ] **Step 2: Remove the inline banner and add subtitle**

Find the `step === "results"` block. Remove the inline banner (the div containing `Sparkles`) and add the subtitle below the h2.

```tsx
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

            {matchedPhotos.length === 0 ? (
```

- [ ] **Step 3: Compile and verify**

Run: `npx tsc --noEmit`
Expected: Output is empty (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/share/\\[token\\]/guest/page.tsx
git commit -m "refactor: remove old banner and add selection instructions"
```

---

### Task 2: Refactor Photo Grid Interaction

**Files:**
- Modify: `d:\antigravity\files\fotohaven\src\app\share\[token]\guest\page.tsx` within the `{matchedPhotos.map((photo, index) => {` block.

- [ ] **Step 1: Swap button interactions**

Make the main card area trigger selection, and add a small top-right icon button to trigger the lightbox. Swap `onClick` assignments.

```tsx
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
                            transition: "transform 0.2s ease" 
                          }}
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
                        onClick={() => setLightbox({ photos: matchedPhotos, index })}
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
                        aria-label="View large photo"
                      >
                        {selected ? <Check size={16} /> : <Maximize size={14} />}
                      </button>
                    </div>
```

- [ ] **Step 2: Compile and verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/share/\\[token\\]/guest/page.tsx
git commit -m "feat: switch to tap-to-select interaction paradigm"
```

---

### Task 3: Add Sticky Actions Bar

**Files:**
- Modify: `d:\antigravity\files\fotohaven\src\app\share\[token]\guest\page.tsx:754-754` (Bottom of file render)

- [ ] **Step 1: Add the sticky bottom bar component**

Insert this block directly above the closing `</div>` tag for the main `.card` container, ensuring it renders when `confirmedPhotoIds.length > 0`.

```tsx
      </div>

      {confirmedPhotoIds.length > 0 && (
        <div style={{
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
          zIndex: 50
        }}>
          <div style={{ width: "100%", maxWidth: 980, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--espresso)" }}>
              {confirmedPhotoIds.length} photo{confirmedPhotoIds.length !== 1 ? 's' : ''} selected
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

      {lightbox && (
```

- [ ] **Step 2: Compile and verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/share/\\[token\\]/guest/page.tsx
git commit -m "feat: add sticky bottom actions bar for photo selection"
```
