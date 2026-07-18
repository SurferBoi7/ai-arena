import type { Model } from "../types";
import { fmtScore, monogram, statusChipClass, tierLabel, dateLabel } from "../lib/format";
import { colorFromString } from "../lib/format";

export function ModelRow({
  model,
  rank,
  onOpen,
}: {
  model: Model;
  rank: number;
  onOpen?: () => void;
}) {
  const rankClass = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "";
  return (
    <div
      className={`model-row ${onOpen ? "model-row-tap" : ""}`}
      role={onOpen ? "button" : "listitem"}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      <div className={`rank ${rankClass}`}>{rank}</div>
      <div
        className="monogram"
        style={{ background: colorFromString(model.providerKey || model.provider || model.name) }}
        aria-hidden
      >
        {monogram(model.name, model.providerKey)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="model-name">{model.name}</div>
        <div className="model-meta">
          <span>{model.provider}</span>
          <span>·</span>
          <span>{tierLabel(model.tier)}</span>
          <span>·</span>
          <span>{model.benchmarkCount}/8 benchmarks</span>
          {model.released ? (
            <>
              <span>·</span>
              <span>{dateLabel(model.released)}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="model-right">
        <div className="score score-lg">{fmtScore(model.ultimateScore)}</div>
        <div className="mt-8">
          <span className={statusChipClass(model.scoreStatus)}>{model.scoreStatus}</span>
        </div>
      </div>
    </div>
  );
}
