# Guest Discovery UX Refinement Design

## Goal
Improve the intuitiveness and user experience of the "Find more photos like this person" feature in the Guest Photo Discovery results.

## Chosen Approach: The "Mobile Gallery" Paradigm (Approach 1)

### Visual Changes
1. **Remove Heavy Banner:** Remove the large inline banner that currently explains the refinement process with technical terms.
2. **Add Header Subtitle:** Add simple helper text directly beneath the main page title: *"Missing some photos? Tap up to 3 photos of yourself to improve the search."*

### Interaction Changes
1. **Photo Card Selection:** 
   - When a guest taps a matched photo, the *entire* photo card scales down slightly (e.g., `transform: scale(0.95)`) and gains a prominent gold border. 
   - This replaces the small, hard-to-tap checkbox overlay in the corner.
2. **Sticky Actions Bar:** 
   - As soon as at least 1 photo is selected (`confirmedPhotoIds.length > 0`), a sticky banner fades in at the bottom edge of the viewport (`position: fixed`, `bottom: 0`, `left: 0`, `right: 0`, `z-index: 50`). 
3. **Sticky Actions Bar Layout:**
   - Text: "{N} photo(s) selected"
   - Button: "Find Better Matches" (This button triggers the existing `refineMatches` logic).
   - Button: "Clear" (To empty `confirmedPhotoIds`).

### Component Impacts
- **`src/app/share/[token]/guest/page.tsx`**
  - Delete the UI block containing the `div` with the `Sparkles` icon and the instructions under `{matchedPhotos.length > 0 && (...)}`.
  - Update the returned layout in `photo-grid` map:
    - Change the outer `div` to handle border based on `selected`.
    - Change the `<img />` wrapper to have a transition on internal scale when `selected` is `true`.
  - Add a fixed/sticky footer component conditionally rendered when `confirmedPhotoIds.length > 0`.

## Alternative Considered: "Guided Review Wizard" (Approach 2)
*Documented for historical reference as requested by the user.*
- **Concept:** Force a review step before showing the full photo grid.
- **Flow:** Top 1-5 results are shown in a swipeable carousel on a separate step. The user is prompted "Is this you? [Yes] / [No]". Once they confirm up to 3 photos, the app automatically triggers the refined search and *then* drops them into the full grid of results.
- **Reason for Rejection:** While completely unambiguous, it interrupts the instant gratification of viewing results immediately. We opted for the non-blocking Mobile Gallery approach (Approach 1) instead.
