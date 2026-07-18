// =============================================================================
// TimelineGraph — fluid, responsive score×date chart with pan & zoom.
// =============================================================================
// x-axis = release date, y-axis = Arena score. The chart measures its own width
// (ResizeObserver) so it never overflows, and exposes a normalised [start,end]
// viewport that the user can:
//   • wheel / trackpad-scroll to zoom (anchored at the cursor)
//   • two-finger pinch to zoom (anchored at the pinch midpoint)
//   • drag / swipe to pan
// Month ticks and top-score labels are re-thinned to the visible range so text
// never overlaps at any zoom level. Tapping a point opens its Model Sheet.
// =============================================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Model } from "../types";
import { fmtScore, colorFromString } from "../lib/format";

const MIN_SPAN = 0.06; // deepest zoom (~16×)
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

interface Pt {
  model: Model;
  xNorm: number;
  y: number;
}

export function TimelineGraph({
  models,
  onSelect,
}: {
  models: Model[];
  onSelect?: (m: Model) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(640);
  const H = 300;
  const padL = 36;
  const padR = 16;
  const padT = 18;
  const padB = 40;
  const plotW = Math.max(10, W - padL - padR);
  const plotH = H - padT - padB;

  const [view, setView] = useState({ start: 0, end: 1 });

  // --- responsive width ---
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- base geometry (independent of viewport) ---
  const base = useMemo(() => {
    const dated = models.filter(
      (m) => m.released && !Number.isNaN(new Date(m.released).getTime()),
    );
    if (dated.length === 0) return null;
    const times = dated.map((m) => new Date(m.released!).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const span = Math.max(maxT - minT, 86400000);
    const pts: Pt[] = dated
      .map((m) => ({
        model: m,
        xNorm: (new Date(m.released!).getTime() - minT) / span,
        y: m.ultimateScore,
      }))
      .sort((a, b) => b.y - a.y);
    const maxY = Math.max(...pts.map((p) => p.y), 100);
    return { pts, minT, maxT, span, maxY };
  }, [models]);

  // Reset the viewport when the underlying model set changes.
  useEffect(() => {
    setView({ start: 0, end: 1 });
  }, [base?.pts.length]);

  const domainSpan = view.end - view.start;
  const xToPx = (xNorm: number) => padL + ((xNorm - view.start) / domainSpan) * plotW;
  const yScale = (y: number) =>
    padT + plotH - (y / (base?.maxY ?? 100)) * plotH;

  function clampView(start: number, end: number) {
    let span = clamp(end - start, MIN_SPAN, 1);
    if (start < 0) start = 0;
    if (start + span > 1) start = 1 - span;
    start = Math.max(0, start);
    return { start, end: start + span };
  }

  function zoomAt(frac: number, factor: number) {
    setView((v) => {
      const span = v.end - v.start;
      const cursor = v.start + frac * span;
      const newSpan = clamp(span * factor, MIN_SPAN, 1);
      return clampView(cursor - frac * newSpan, cursor - frac * newSpan + newSpan);
    });
  }

  // --- wheel zoom (native, non-passive so we can preventDefault) ---
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const scale = W / rect.width;
      const px = (e.clientX - rect.left) * scale;
      const frac = clamp((px - padL) / plotW, 0, 1);
      const factor = e.deltaY < 0 ? 0.82 : 1 / 0.82;
      zoomAt(frac, factor);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, plotW]);

  // --- pointer pan / pinch ---
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({
    mode: "none" as "none" | "pan" | "pinch",
    lastX: 0,
    startX: 0,
    startY: 0,
    moved: false,
    pinchDist: 0,
    pinchFrac: 0.5,
  });

  function svgScale() {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return { rect, scale: W / rect.width };
  }

  function onPointerDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current.mode = "pan";
      gesture.current.lastX = e.clientX;
      gesture.current.startX = e.clientX;
      gesture.current.startY = e.clientY;
      gesture.current.moved = false;
    } else if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const { rect, scale } = svgScale();
      gesture.current.mode = "pinch";
      gesture.current.pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const midX = (p1.x + p2.x) / 2;
      gesture.current.pinchFrac = clamp(((midX - rect.left) * scale - padL) / plotW, 0, 1);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.mode === "pinch" && pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (g.pinchDist > 0 && dist > 0) zoomAt(g.pinchFrac, g.pinchDist / dist);
      g.pinchDist = dist;
    } else if (g.mode === "pan") {
      const { scale } = svgScale();
      const dx = (e.clientX - g.lastX) * scale;
      g.lastX = e.clientX;
      if (Math.abs(e.clientX - g.startX) > 4 || Math.abs(e.clientY - g.startY) > 4) g.moved = true;
      setView((v) => {
        const span = v.end - v.start;
        return clampView(v.start - (dx / plotW) * span, v.start - (dx / plotW) * span + span);
      });
    }
  }

  function hitTest(clientX: number, clientY: number): Model | null {
    if (!base) return null;
    const { rect, scale } = svgScale();
    const px = (clientX - rect.left) * scale;
    const py = (clientY - rect.top) * scale;
    let best: Model | null = null;
    let bestD = 16;
    for (const p of base.pts) {
      if (p.xNorm < view.start || p.xNorm > view.end) continue;
      const d = Math.hypot(xToPx(p.xNorm) - px, yScale(p.y) - py);
      if (d < bestD) {
        bestD = d;
        best = p.model;
      }
    }
    return best;
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current;
    const wasTap = g.mode === "pan" && !g.moved && pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (wasTap && onSelect) {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit) onSelect(hit);
    }
    if (pointers.current.size === 0) {
      g.mode = "none";
    } else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      g.mode = "pan";
      g.lastX = p.x;
      g.startX = p.x;
      g.startY = p.y;
      g.moved = false;
    }
  }

  // --- month ticks over the visible range ---
  const months = useMemo(() => {
    if (!base) return [];
    const d = new Date(base.minT);
    d.setDate(1);
    const all: { x: number; label: string }[] = [];
    while (d.getTime() <= base.maxT) {
      const xNorm = (d.getTime() - base.minT) / base.span;
      if (xNorm >= view.start - 0.001 && xNorm <= view.end + 0.001) {
        const showYear = d.getMonth() === 0;
        all.push({
          x: xToPx(xNorm),
          label: d.toLocaleDateString("en-GB", showYear ? { month: "short", year: "2-digit" } : { month: "short" }),
        });
      }
      d.setMonth(d.getMonth() + 1);
    }
    const out: { x: number; label: string }[] = [];
    let lastX = -Infinity;
    for (const m of all) {
      if (m.x - lastX >= 56) {
        out.push(m);
        lastX = m.x;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, view, plotW, padL]);

  // --- top-score labels within the visible range, collision-avoided ---
  const labels = useMemo(() => {
    if (!base) return new Map<string, { x: number; y: number; anchor: "start" | "end"; name: string }>();
    // Candidates: highest scores first. We only *place* a label if a clear,
    // non-overlapping slot exists — otherwise it is skipped entirely, so text
    // never crowds. Zooming in spreads points out and reveals more labels.
    const visible = base.pts.filter((p) => p.xNorm >= view.start && p.xNorm <= view.end);
    const chosen = visible.slice(0, 8);
    const map = new Map<string, { x: number; y: number; anchor: "start" | "end"; name: string }>();
    const placed: { x: number; y: number; w: number }[] = [];
    for (const p of chosen) {
      const dotX = xToPx(p.xNorm);
      const dotY = yScale(p.y);
      const nearRight = dotX > padL + plotW * 0.62;
      const anchor: "start" | "end" = nearRight ? "end" : "start";
      const baseOffX = nearRight ? -9 : 9;
      const name = p.model.name.length > 16 ? p.model.name.slice(0, 15) + "…" : p.model.name;
      const label = `${name} (${fmtScore(p.y)})`;
      const approxW = Math.min(label.length * 4.7, 96);
      const lx = nearRight ? dotX + baseOffX - approxW : dotX + baseOffX;
      const rx = lx + approxW;
      let chosenY: number | null = null;
      for (const off of [-11, 11, -22, 22, -33, 33, -44, 44, 0]) {
        const ty = dotY + 3 + off;
        if (ty < padT + 8 || ty > padT + plotH - 2) continue;
        const clash = placed.some(
          (q) => lx < q.x + q.w + 5 && rx > q.x - 5 && Math.abs(ty - q.y) < 11,
        );
        if (!clash) {
          chosenY = ty;
          break;
        }
      }
      if (chosenY === null) continue; // no clear slot — skip rather than overlap
      placed.push({ x: lx, y: chosenY, w: approxW });
      map.set(p.model.id, { x: dotX + baseOffX, y: chosenY, anchor, name: label });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, view, plotW, padL]);

  if (!base) {
    return <div className="muted center" style={{ padding: 40 }}>No dated models.</div>;
  }

  const visibleCount = base.pts.filter((p) => p.xNorm >= view.start && p.xNorm <= view.end).length;
  const zoomed = domainSpan < 0.999;
  const clipId = "tl-clip";

  return (
    <div className="timeline-wrap" ref={wrapRef}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="section-head" style={{ margin: 0, flex: 0 }}>
          Score × release date
        </div>
        <div className="row gap-6">
          <span className="tiny muted">{visibleCount} shown</span>
          {zoomed ? (
            <button className="chip" onClick={() => setView({ start: 0, end: 1 })}>
              Reset
            </button>
          ) : null}
        </div>
      </div>

      <svg
        ref={svgRef}
        className="timeline-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Interactive timeline graph of Arena score against release date. Scroll or pinch to zoom, drag to pan."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: gesture.current.mode === "pan" ? "grabbing" : "grab",
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={padL} y={padT - 6} width={plotW} height={plotH + 6} />
          </clipPath>
        </defs>

        <g className="tl-grid">
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={yScale(g)} y2={yScale(g)} />
              <text x={padL - 6} y={yScale(g) + 3} textAnchor="end" className="tl-label">
                {g}
              </text>
            </g>
          ))}
          <g clipPath={`url(#${clipId})`}>
            {months.map((m, i) => (
              <text key={i} x={m.x} y={H - padB + 16} textAnchor="middle" className="tl-label">
                {m.label}
              </text>
            ))}
          </g>
        </g>

        <g clipPath={`url(#${clipId})`}>
          {base.pts.map((p) => {
            if (p.xNorm < view.start - 0.02 || p.xNorm > view.end + 0.02) return null;
            const layout = labels.get(p.model.id);
            const isLabel = !!layout;
            const isFlagship = /fable|mythos|opus/i.test(p.model.name);
            const color = isFlagship
              ? "#7c5cff"
              : colorFromString(p.model.providerKey || p.model.name);
            const r = isLabel ? 5 : 3.2;
            return (
              <g key={p.model.id}>
                <circle
                  className="tl-dot"
                  cx={xToPx(p.xNorm)}
                  cy={yScale(p.y)}
                  r={r}
                  fill={color}
                  opacity={isLabel ? 1 : 0.55}
                />
                {isLabel ? (
                  <text
                    x={layout!.x}
                    y={layout!.y}
                    fontSize="9"
                    fill="#e8eaf0"
                    fontWeight="600"
                    textAnchor={layout!.anchor}
                  >
                    {layout!.name}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="tiny muted" style={{ marginTop: 6 }}>
        Flagships (Fable · Mythos · Opus) in violet · scroll or pinch to zoom, drag to pan, tap a
        point for details.
      </div>
    </div>
  );
}
