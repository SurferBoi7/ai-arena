import { useMemo } from "react";
import type { Model } from "../types";
import { fmtScore } from "../lib/format";
import { colorFromString } from "../lib/format";

// Timeline graph: x-axis = release date, y-axis = Arena score.
// Each model is a point; the leading flagships are labelled.
export function TimelineGraph({ models }: { models: Model[] }) {
  const points = useMemo(() => {
    const dated = models.filter(
      (m) => m.released && !Number.isNaN(new Date(m.released).getTime()),
    );
    if (dated.length === 0) return [];
    const times = dated.map((m) => new Date(m.released!).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const span = Math.max(maxT - minT, 86400000);
    return dated
      .map((m) => {
        const t = new Date(m.released!).getTime();
        return {
          model: m,
          x: (t - minT) / span,
          y: m.ultimateScore,
        };
      })
      .sort((a, b) => b.y - a.y);
  }, [models]);

  if (points.length === 0) {
    return <div className="muted center" style={{ padding: 40 }}>No dated models.</div>;
  }

  const W = 640;
  const H = 260;
  const padL = 34;
  const padR = 16;
  const padT = 16;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxY = Math.max(...points.map((p) => p.y), 100);
  const minY = 0;
  const yScale = (y: number) => padT + plotH - ((y - minY) / (maxY - minY)) * plotH;
  const xScale = (x: number) => padL + x * plotW;

  // Label the top 6 for readability, with simple collision avoidance so labels
  // in the dense top-right cluster don't overlap.
  const labelledPoints = points.slice(0, 6);
  const labelLayout = new Map<
    string,
    { x: number; y: number; anchor: "start" | "end"; name: string }
  >();
  const placed: { x: number; y: number }[] = [];
  for (const p of labelledPoints) {
    const dotX = xScale(p.x);
    const dotY = yScale(p.y);
    const nearRight = p.x > 0.7;
    const anchor = nearRight ? "end" : "start";
    const baseOffX = nearRight ? -8 : 8;
    const name = p.model.name.length > 16 ? p.model.name.slice(0, 15) + "…" : p.model.name;
    const label = `${name} (${fmtScore(p.y)})`;
    const approxW = Math.min(label.length * 4.6, 92);
    let chosenY = dotY + 3;
    for (const off of [0, -13, 13, -26, 26, -39, 39]) {
      const ty = dotY + 3 + off;
      const lx = nearRight ? dotX + baseOffX - approxW : dotX + baseOffX;
      const rx = lx + approxW;
      const clash = placed.some(
        (q) => lx < q.x + 4 && rx > q.x - 4 && Math.abs(ty - q.y) < 10,
      );
      if (!clash) {
        chosenY = ty;
        break;
      }
    }
    const lx = nearRight ? dotX + baseOffX - approxW : dotX + baseOffX;
    placed.push({ x: lx, y: chosenY });
    labelLayout.set(p.model.id, { x: dotX + baseOffX, y: chosenY, anchor, name: label });
  }

  const months = useMemo(() => {
    const times = points.map((p) => new Date(p.model.released!).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const d = new Date(minT);
    d.setDate(1);
    const all: { x: number; label: string }[] = [];
    while (d.getTime() <= maxT) {
      const frac = (d.getTime() - minT) / Math.max(maxT - minT, 1);
      all.push({
        x: xScale(frac),
        label: d.toLocaleDateString("en-GB", { month: "short" }),
      });
      d.setMonth(d.getMonth() + 1);
    }
    // Thin labels so they don't collide (~60px minimum spacing).
    const out: { x: number; label: string }[] = [];
    let lastX = -Infinity;
    for (const m of all) {
      if (m.x - lastX >= 58) {
        out.push(m);
        lastX = m.x;
      }
    }
    return out;
  }, [points]);

  return (
    <div className="timeline-wrap">
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="section-head" style={{ margin: 0, flex: 0 }}>
          Score × release date
        </div>
        <span className="tiny muted">{points.length} dated models</span>
      </div>
      <svg className="timeline-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Timeline graph of Arena score against release date">
        <g className="tl-grid">
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={yScale(g)} y2={yScale(g)} />
              <text x={padL - 6} y={yScale(g) + 3} textAnchor="end" className="tl-label">
                {g}
              </text>
            </g>
          ))}
          {months.map((m, i) => (
            <text key={i} x={m.x} y={H - padB + 14} textAnchor="middle" className="tl-label">
              {m.label}
            </text>
          ))}
        </g>

        {points.map((p) => {
          const layout = labelLayout.get(p.model.id);
          const isLabel = !!layout;
          const isFlagship = /fable|mythos|opus/i.test(p.model.name);
          const color = isFlagship ? "#7c5cff" : colorFromString(p.model.providerKey || p.model.name);
          const r = isLabel ? 5 : 3;
          return (
            <g key={p.model.id}>
              <circle
                className="tl-dot"
                cx={xScale(p.x)}
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
      </svg>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        Flagships (Fable · Mythos · Opus) shown in violet. Top 6 labelled with collision avoidance.
      </div>
    </div>
  );
}
