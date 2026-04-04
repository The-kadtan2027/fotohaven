"use client";

import { Check, X } from "lucide-react";
import type { DuplicateGroup } from "./album-utils";

export default function DuplicateModal({
  groups,
  threshold,
  onClose,
  onSelectDuplicates,
}: {
  groups: DuplicateGroup[];
  threshold: number;
  onClose: () => void;
  onSelectDuplicates: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,18,8,0.7)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: "min(1100px, 100%)", maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ padding: 20, borderBottom: "1px solid var(--sand)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--espresso)", marginBottom: 4 }}>Duplicate Review</h3>
            <p style={{ fontSize: 13, color: "var(--brown)" }}>
              Threshold ≤ {threshold}. The oldest photo in each group is kept, and the rest can be selected in one click.
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--taupe)" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: "auto", display: "grid", gap: 18 }}>
          {groups.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--taupe)" }}>
              No duplicate groups found at this threshold.
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.keep.id} style={{ border: "1px solid var(--sand)", borderRadius: 16, padding: 16, background: "var(--warm-white)" }}>
                <p style={{ fontSize: 12, color: "var(--taupe)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                  Keep oldest · {group.keep.originalName}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                  {[group.keep, ...group.duplicates].map((photo, index) => (
                    <div key={photo.id} style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "var(--sand)" }}>
                      <img src={photo.url} alt={photo.originalName} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                      <div style={{ position: "absolute", inset: "auto 0 0 0", padding: "18px 10px 10px", background: "linear-gradient(transparent, rgba(26,18,8,0.7))", color: "#fff" }}>
                        <p style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{photo.originalName}</p>
                        <p style={{ fontSize: 10, opacity: 0.8 }}>{index === 0 ? "Keep" : "Duplicate"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ padding: 20, borderTop: "1px solid var(--sand)", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <button className="btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>
            Close
          </button>
          {groups.length > 0 ? (
            <button className="btn-gold" onClick={onSelectDuplicates} style={{ fontSize: 12 }}>
              <Check size={12} />
              Select All Duplicates
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
