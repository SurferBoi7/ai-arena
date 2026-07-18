// =============================================================================
// Sheet — reusable spring-animated bottom sheet / modal.
// =============================================================================
// True-black frosted-glass panel that springs up from the bottom, with a
// fading backdrop, drag-handle, Escape-to-close, body scroll-lock, and a
// graceful exit animation. Shared by the Feed model pop-up and the Settings
// digest preview so both feel identical.
// =============================================================================

import { useEffect, useRef, useState } from "react";

export function Sheet({
  onClose,
  children,
  labelledBy,
  size = "md",
}: {
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
  size?: "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Play the enter animation on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Body scroll-lock while the sheet is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function requestClose() {
    if (leaving) return;
    setLeaving(true);
    setOpen(false);
    window.setTimeout(onClose, 260);
  }

  // Escape to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  return (
    <div
      className={`sheet-backdrop ${open ? "open" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        className={`sheet sheet-${size} ${open ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        <button className="sheet-handle" onClick={requestClose} aria-label="Close">
          <span />
        </button>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
