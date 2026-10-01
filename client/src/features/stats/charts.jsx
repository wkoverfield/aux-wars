import { EMPTY, num } from "./statsModel";

const GREEN = "#68d570";

/**
 * Card shell matching the homepage sections. min-w-0 lets a card shrink
 * inside a grid or flex track, so long labels truncate instead of widening
 * the page.
 */
export function Card({ title, aside, children, className = "" }) {
  return (
    <section className={`min-w-0 bg-white/5 border border-white/10 rounded-xl p-5 ${className}`}>
      {(title || aside) && (
        <header className="flex items-baseline justify-between gap-3 mb-4">
          {title && <h2 className="text-base font-bold text-white">{title}</h2>}
          {aside && <div className="text-sm text-gray-400 text-right">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** One headline number with a label and optional detail line. */
export function Stat({ label, value, detail, accent = false }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-3xl font-bold tabular-nums ${accent ? "text-[#68d570]" : "text-white"}`}>{value}</p>
      {detail && <p className="text-xs text-gray-500 mt-1">{detail}</p>}
    </div>
  );
}

export function EmptyNote({ children }) {
  return <p className="text-sm text-gray-500">{children}</p>;
}

/**
 * Vertical bar chart from CSS boxes. `points` is `[{ key, label, value }]`;
 * a null value draws a faint stub so gaps in the rollups stay visible.
 */
export function BarChart({ points, format, ariaLabel, height = 96, axisLabels }) {
  const values = points.map((p) => num(p.value)).filter((v) => v !== null);
  const max = values.length ? Math.max(...values) : 0;
  const hasData = values.some((v) => v > 0);

  return (
    <div>
      <div
        role="img"
        aria-label={ariaLabel}
        className="flex items-end gap-[2px] border-b border-white/10"
        style={{ height }}
      >
        {points.map((p) => {
          const v = num(p.value);
          const pct = v === null || max <= 0 ? 0 : Math.max((v / max) * 100, v > 0 ? 3 : 0);
          return (
            <div
              key={p.key}
              title={`${p.label}: ${v === null ? "no data" : format(v)}`}
              className="flex-1 h-full flex items-end min-w-0"
            >
              {v === null ? (
                <div className="w-full h-[2px] bg-white/10 rounded-sm" />
              ) : (
                <div
                  className="w-full rounded-t-sm"
                  style={{ height: `${pct}%`, minHeight: v > 0 ? 2 : 1, background: v > 0 ? GREEN : "rgba(255,255,255,0.15)" }}
                />
              )}
            </div>
          );
        })}
      </div>
      {axisLabels && (
        <div className="flex justify-between text-[11px] text-gray-500 mt-1 tabular-nums">
          {axisLabels.map((label, i) => (
            <span key={`${label}-${i}`}>{label}</span>
          ))}
        </div>
      )}
      {!hasData && <p className="text-xs text-gray-500 mt-2">No data in this window yet.</p>}
    </div>
  );
}

/** Horizontal bars for ranked lists (funnel, phases, searches). */
export function RankedBars({ rows, format, emptyText }) {
  const max = rows.reduce((m, r) => Math.max(m, num(r.value) ?? 0), 0);
  if (!rows.length || max <= 0) return <EmptyNote>{emptyText}</EmptyNote>;

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const v = num(row.value);
        const pct = v === null || max <= 0 ? 0 : (v / max) * 100;
        return (
          <li key={row.key ?? row.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-gray-200 truncate min-w-0" title={row.label}>{row.label}</span>
              <span className="text-white font-semibold tabular-nums shrink-0">
                {v === null ? EMPTY : format(v)}
                {row.note && <span className="text-gray-400 font-normal ml-2">{row.note}</span>}
              </span>
            </div>
            <div className="h-2 mt-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: GREEN }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
