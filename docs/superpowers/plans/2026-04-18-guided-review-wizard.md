# Guided Review Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Approach 2 ("Guided Review") as an intermediate step after the initial selfie scan, prompting the user to quickly verify the top 5 matches before landing them in the full gallery grid. This works *alongside* the existing Approach 1.

**Architecture:** We will insert a new `"review"` step into the `GuestFaceDiscoveryPage` component state. After the first pass (`source === "selfie"`), we render a one-by-one verification UI for up to 5 highest-confidence photos. If they select "Yes" for at least 1 photo, we automatically trigger the refined matching search before transferring them to the `"results"` step.

**Tech Stack:** Next.js React Client Components.

---

### Task 1: Add State and Update Types

**Files:**
- Modify: `d:\antigravity\files\fotohaven\src\app\share\[token]\guest\page.tsx:30-65`

- [ ] **Step 1: Expand the Step type**

Add `"review"` to the Step type definition.
```tsx
type Step = "otp" | "consent" | "scan" | "review" | "results";
```

- [ ] **Step 2: Add review state variables**

Add `reviewIndex` and `reviewSelections` into the state variables inside `GuestFaceDiscoveryPage`.
```tsx
  const [matchSource, setMatchSource] = useState<MatchSource>("selfie");
  const [lightbox, setLightbox] = useState<{ photos: MatchedPhoto[]; index: number } | null>(null);
  const [lightboxFullLoaded, setLightboxFullLoaded] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewSelections, setReviewSelections] = useState<string[]>([]);
```

- [ ] **Step 3: Compile and verify**

Run: `npx tsc --noEmit`
Expected: Output is empty (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/share/\\[token\\]/guest/page.tsx
git commit -m "feat: add review step state variables"
```

---

### Task 2: Inject the Review Logic into `loadMatchedPhotos`

**Files:**
- Modify: `d:\antigravity\files\fotohaven\src\app\share\[token]\guest\page.tsx` (inside `loadMatchedPhotos` function)

- [ ] **Step 1: Direct flow to the review step**

Inside `loadMatchedPhotos`, locate the logic handling `resolvedSource`. Update the control flow so an initial selfie match goes to the review step. (Keep the `if (!scored.length)` check intact to skip review if zero matches are found).
```tsx
    const resolvedSource = matchData.source || source;
    setMatchSource(resolvedSource);
    setGuestName(matchData.guest?.name || options?.fallbackName || "");
    
    const scored = matchData.photos || [];

    if (!scored.length) {
      setMatchedPhotos([]);
      setStep("results");
      setConfirmedPhotoIds([]);
      setStatus("");
      return;
    }

    if (resolvedSource === "selfie") {
      setConfirmedPhotoIds([]);
      setReviewIndex(0);
      setReviewSelections([]);
    }
```
And at the end of the `loadMatchedPhotos` function, update the final `setStep` call to check the source:
```tsx
    const matched: MatchedPhoto[] = scored
      .map((m) => {
        const photo = photoMap.get(m.photoId);
        return photo ? { ...photo, score: m.score } : null;
      })
      .filter((p): p is MatchedPhoto => p !== null);

    setMatchedPhotos(matched);
    setStep(resolvedSource === "selfie" ? "review" : "results");
    setStatus("");
  }
```

- [ ] **Step 2: Add `handleReviewChoice` helper function**

Add this logic below `loadMatchedPhotos` (or near `refineMatches`) to process the Yes/No buttons in the review UI.
```tsx
  async function handleReviewChoice(isMe: boolean) {
    const currentPhotoId = matchedPhotos[reviewIndex].id;
    const newSelections = isMe ? [...reviewSelections, currentPhotoId] : reviewSelections;
    
    if (isMe) setReviewSelections(newSelections);
    
    const maxReviewPhotos = Math.min(5, matchedPhotos.length);
    if (newSelections.length >= 3 || reviewIndex + 1 >= maxReviewPhotos) {
      if (newSelections.length > 0) {
        setBusy(true);
        setStatus("Finding more photos based on your review...");
        try {
          await loadMatchedPhotos({ source: "refined", photoIds: newSelections });
        } catch (err: any) {
          setError(err.message || "Failed to refine matches");
          setStep("results");
        } finally {
          setBusy(false);
        }
      } else {
        setStep("results");
      }
    } else {
      setReviewIndex(i => i + 1);
    }
  }
```

- [ ] **Step 3: Compile and verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/share/\\[token\\]/guest/page.tsx
git commit -m "feat: handle logic flow for intermediate review step"
```

---

### Task 3: Build the Review Step UI

**Files:**
- Modify: `d:\antigravity\files\fotohaven\src\app\share\[token]\guest\page.tsx` (in the render stack, before `{step === "results" && ...}`)

- [ ] **Step 1: Add the Review UI block**

Insert the following block above the `step === "results"` block to render the one-by-one verification wizard.

```tsx
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
```

- [ ] **Step 2: Compile and verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/share/\\[token\\]/guest/page.tsx
git commit -m "feat: implement guided review wizard UI for up to 5 matches"
```
