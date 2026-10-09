import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { BarChart, Card, EmptyNote, RankedBars, Stat } from "./charts";
import {
  EMPTY,
  WINDOWS,
  fmtDateTime,
  fmtDecimal,
  fmtHourUTC,
  fmtInt,
  fmtPct,
  fmtShortDate,
  fmtWait,
  fmtInteractionTarget,
  fmtVital,
  normalizeDashboard,
  normalizeLive,
  SPEED_DEVICES,
  VITAL_THRESHOLDS,
} from "./statsModel";

const TRENDS = [
  { field: "gamesStarted", title: "Games per day", summary: "gamesPerDay", fmt: fmtInt, summaryFmt: (v) => `${fmtDecimal(v)} / day avg` },
  { field: "uniquePlayers", title: "Unique players per day", summary: "uniquePlayersPerDay", fmt: fmtInt, summaryFmt: (v) => `${fmtDecimal(v)} / day avg` },
  { field: "completionRate", title: "Completion rate", summary: "completionRate", fmt: fmtPct, summaryFmt: (v) => `${fmtPct(v)} overall` },
  { field: "avgPlayersPerGame", title: "Avg players per game", summary: "avgPlayersPerGame", fmt: (v) => fmtDecimal(v), summaryFmt: (v) => `${fmtDecimal(v)} overall` },
  { field: "peakPlayersOnline", title: "Peak concurrent per day", summary: "peakPlayersOnline", fmt: fmtInt, summaryFmt: (v) => `${fmtInt(v)} max` },
];

function WindowToggle({ value, onChange }) {
  return (
    <div role="group" aria-label="Trend window" className="inline-flex rounded-full bg-white/5 border border-white/10 p-1">
      {WINDOWS.map((days) => (
        <button
          key={days}
          type="button"
          onClick={() => onChange(days)}
          aria-pressed={value === days}
          className={`px-4 py-1 rounded-full text-sm font-semibold transition-colors ${
            value === days ? "bg-[#68d570] text-black" : "text-gray-300 hover:text-white"
          }`}
        >
          {days} days
        </button>
      ))}
    </div>
  );
}

function LiveNow({ live }) {
  const { now } = live;
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#68d570] opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#68d570]" />
          </span>
          Live now
        </span>
      }
      aside={now.sampledAt ? `Sampled ${fmtDateTime(now.sampledAt)}` : null}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <Stat label="Online" value={fmtInt(now.playersOnline)} accent />
        <Stat label="In a game" value={fmtInt(now.playersInGame)} />
        <Stat label="Active rooms" value={fmtInt(now.activeRooms)} />
        <Stat label="Active games" value={fmtInt(now.activeGames)} />
      </div>
    </Card>
  );
}

function AllTimePeak({ peak }) {
  return (
    <Card title="All-time peak">
      {peak ? (
        <div className="grid grid-cols-2 gap-5">
          <Stat
            label="Online at once"
            value={fmtInt(peak.playersOnline)}
            detail={peak.playersOnlineAt ? fmtDateTime(peak.playersOnlineAt) : null}
            accent
          />
          <Stat
            label="In a game at once"
            value={fmtInt(peak.playersInGame)}
            detail={peak.playersInGameAt ? fmtDateTime(peak.playersInGameAt) : null}
          />
        </div>
      ) : (
        <EmptyNote>No peak recorded yet. The first sample lands within a minute of someone playing.</EmptyNote>
      )}
    </Card>
  );
}

function TodaySoFar({ today }) {
  return (
    <Card title="Today so far" aside="UTC day">
      {today ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          <Stat label="Games started" value={fmtInt(today.gamesStarted)} accent />
          <Stat label="Games finished" value={fmtInt(today.gamesCompleted)} />
          <Stat label="Unique players" value={fmtInt(today.uniquePlayers)} />
          <Stat label="Player joins" value={fmtInt(today.playerJoins)} />
          <Stat label="Peak online" value={fmtInt(today.peakPlayersOnline)} />
          <Stat label="Homepage visitors" value={fmtInt(today.homepageUniques)} />
        </div>
      ) : (
        <EmptyNote>Nothing recorded today yet.</EmptyNote>
      )}
    </Card>
  );
}

function Trends({ dashboard, windowDays }) {
  const { days, summary } = dashboard;
  const axis = days.length
    ? [fmtShortDate(days[0].date), fmtShortDate(days[Math.floor(days.length / 2)].date), fmtShortDate(days[days.length - 1].date)]
    : null;

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {TRENDS.map((t) => (
        <Card key={t.field} title={t.title} aside={summary[t.summary] === null ? null : t.summaryFmt(summary[t.summary])}>
          <BarChart
            ariaLabel={`${t.title}, last ${windowDays} days`}
            points={days.map((d) => ({ key: d.date, label: fmtShortDate(d.date), value: d.missing ? null : d[t.field] }))}
            format={t.fmt}
            axisLabels={axis}
          />
        </Card>
      ))}
      <Card title="Coverage" aside={`last ${windowDays} days`}>
        <Stat
          label="Days with rollups"
          value={`${summary.daysWithData} of ${windowDays}`}
          detail="Days before the raw event window stay blank rather than estimated."
        />
      </Card>
    </div>
  );
}

function HourlyCurve({ hourly }) {
  if (!hourly.length) {
    return (
      <Card title="Hourly peak">
        <EmptyNote>No hourly samples yet.</EmptyNote>
      </Card>
    );
  }
  const absolute = hourly.every((h) => h.start !== null);
  const points = hourly.map((h, i) => ({
    key: h.start ?? `h${h.hourUTC}-${i}`,
    label: absolute ? fmtDateTime(h.start) : fmtHourUTC(h.hourUTC),
    value: h.playersOnline,
  }));
  const busiest = hourly.reduce((best, h) => ((h.playersOnline ?? -1) > (best?.playersOnline ?? -1) ? h : best), null);
  const first = hourly[0];
  const last = hourly[hourly.length - 1];

  return (
    <Card
      title="Hourly peak: players online"
      aside={busiest?.playersOnline > 0 ?`Busiest ${fmtHourUTC(busiest.hourUTC)} (${fmtInt(busiest.playersOnline)})` : null}
    >
      <BarChart
        ariaLabel="Peak players online per hour"
        points={points}
        format={fmtInt}
        height={120}
        axisLabels={[fmtHourUTC(first.hourUTC), fmtHourUTC(last.hourUTC)]}
      />
    </Card>
  );
}

function Retention({ retention }) {
  const rows = [
    { key: "d1", label: "Day 1" },
    { key: "d7", label: "Day 7" },
    { key: "d30", label: "Day 30" },
  ];
  const any = rows.some((r) => retention[r.key]);
  return (
    <Card title="Retention: players who came back">
      {any ? (
        <div className="grid grid-cols-3 gap-5">
          {rows.map((r) => {
            const point = retention[r.key];
            let detail = null;
            if (point?.cohort != null && point.returned != null) detail = `${fmtInt(point.returned)} of ${fmtInt(point.cohort)}`;
            else if (point?.cohort) detail = `cohort of ${fmtInt(point.cohort)}`;
            return <Stat key={r.key} label={r.label} value={point ? fmtPct(point.rate) : EMPTY} detail={detail} accent={r.key === "d1"} />;
          })}
        </div>
      ) : (
        <EmptyNote>Not enough history yet. Retention needs players whose first game is at least a day old.</EmptyNote>
      )}
    </Card>
  );
}

function Funnel({ funnel, windowDays }) {
  const rows = funnel.map((step, i) => ({
    key: step.key,
    label: step.label,
    value: step.value,
    note: i === 0 || step.ofPrevious === null ? null : `${fmtPct(step.ofPrevious)} of previous`,
  }));
  return (
    <Card title="Funnel" aside={`last ${windowDays} days`}>
      <RankedBars rows={rows} format={fmtInt} emptyText="No visits recorded in this window yet." />
    </Card>
  );
}

const FAIL_REASON_LABELS = {
  network: "Network",
  timeout: "Timed out",
  bad_payload: "Bad response",
  unknown: "Unknown",
};

function failReasonLabel(reason) {
  if (FAIL_REASON_LABELS[reason]) return FAIL_REASON_LABELS[reason];
  const http = /^http_(\d{3})$/.exec(reason);
  return http ? `HTTP ${http[1]}` : reason;
}

function Searches({ searches, noResultRows, windowDays }) {
  const { failed, failedByReason } = searches;
  return (
    <Card title="Searches" aside={`last ${windowDays} days`}>
      <div className="grid grid-cols-2 gap-5 mb-5">
        <Stat label="No results" value={fmtInt(searches.noResults)} detail="Search worked, nothing matched" />
        <Stat label="Failed" value={fmtInt(failed)} detail="Search service unreachable or errored" />
      </div>
      <div className="space-y-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Failures by reason</h3>
          <RankedBars
            rows={failedByReason.map((r) => ({
              key: r.label,
              label: failReasonLabel(r.label),
              value: r.count,
              note: failed ? fmtPct(r.count / failed) : null,
            }))}
            format={fmtInt}
            emptyText="No failed searches in this window."
          />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Top searches with no results</h3>
          <RankedBars
            rows={noResultRows.slice(0, 10).map((r) => ({ key: r.label, label: r.label, value: r.count }))}
            format={fmtInt}
            emptyText="No empty searches in this window."
          />
        </div>
      </div>
    </Card>
  );
}

function Abandonment({ rows }) {
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  return (
    <Card title="Abandoned games by phase" aside={total ? `${fmtInt(total)} total` : null}>
      <RankedBars
        rows={rows.map((r) => ({ key: r.label, label: r.label, value: r.count, note: fmtPct(r.count / total) }))}
        format={fmtInt}
        emptyText="No abandoned games in this window."
      />
    </Card>
  );
}

function QuickPlay({ qp, windowDays }) {
  const oneVOne =
    qp.oneVOneOffered > 0 ? `1v1: ${fmtInt(qp.oneVOneAccepted)} of ${fmtInt(qp.oneVOneOffered)} offers accepted` : null;
  return (
    <Card title="Quick Play" aside={`last ${windowDays} days`}>
      {qp.clicks ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
            <Stat label="Clicks" value={fmtInt(qp.clicks)} accent />
            <Stat
              label="Match rate"
              value={fmtPct(qp.matchRate)}
              detail={qp.matched !== null ? `${fmtInt(qp.matched)} got a game` : null}
            />
            <Stat label="Median wait" value={fmtWait(qp.medianWaitMs)} detail="Click to game start" />
            <Stat
              label="Left while waiting"
              value={fmtInt(qp.leftWaiting)}
              detail={qp.abandonRate !== null ? `${fmtPct(qp.abandonRate)} of clicks` : null}
            />
            <Stat
              label="Avg players at start"
              value={fmtDecimal(qp.avgPlayersAtStart)}
              detail={qp.gamesStarted ? `${fmtInt(qp.gamesStarted)} games, incl. rematches` : null}
            />
          </div>
          {oneVOne && <p className="text-xs text-gray-500 mt-4">{oneVOne}</p>}
        </>
      ) : (
        <EmptyNote>No Quick Play clicks in this window yet.</EmptyNote>
      )}
    </Card>
  );
}

const DEVICE_LABELS = { all: "All", mobile: "Mobile", chromebook: "Chromebook", desktop: "Desktop" };
const RATING_CLASS = {
  good: "text-[#68d570]",
  "needs-improvement": "text-amber-300",
  poor: "text-red-400",
};

function Speed({ speed, windowDays }) {
  return (
    <Card title="Speed (real devices)" aside={`p75, last ${windowDays} days`}>
      {speed.hasData ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-400">
                <th scope="col" className="text-left font-semibold pb-2 pr-3">Metric</th>
                {SPEED_DEVICES.map((d) => (
                  <th key={d} scope="col" className="text-right font-semibold pb-2 pl-3">
                    {DEVICE_LABELS[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {speed.rows.map((row) => (
                <tr key={row.metric} className="border-t border-white/5">
                  <th scope="row" className="text-left font-semibold text-white py-2 pr-3">
                    {row.metric}
                    <span className="block text-xs font-normal text-gray-500">
                      good under {fmtVital(row.metric, VITAL_THRESHOLDS[row.metric].good)}
                    </span>
                  </th>
                  {SPEED_DEVICES.map((d) => {
                    const c = row.cells[d];
                    return (
                      <td key={d} className={`text-right py-2 pl-3 font-semibold ${RATING_CLASS[c.rating] ?? "text-gray-500"}`}>
                        {fmtVital(row.metric, c.p75)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t border-white/5 text-xs text-gray-500">
                <th scope="row" className="text-left font-normal py-2 pr-3">Samples</th>
                {SPEED_DEVICES.map((d) => (
                  <td key={d} className="text-right py-2 pl-3">{fmtInt(speed.samples[d])}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyNote>No speed samples yet. About 1 in 4 page loads reports, and days show up after their nightly rollup.</EmptyNote>
      )}
      {speed.slowInteractions.length > 0 && (
        <div className="mt-6">
          <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold mb-2">Slowest taps and keystrokes (INP)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th scope="col" className="text-left font-semibold pb-2 pr-3">Where</th>
                  <th scope="col" className="text-right font-semibold pb-2 px-3">p75</th>
                  <th scope="col" className="text-right font-semibold pb-2 px-3">Slow</th>
                  <th scope="col" className="text-left font-semibold pb-2 pl-3">Most time in</th>
                </tr>
              </thead>
              <tbody>
                {speed.slowInteractions.map((r) => (
                  <tr key={`${r.route}|${r.target}`} className="border-t border-white/5">
                    <th scope="row" className="text-left font-normal py-2 pr-3">
                      <span className="text-white">{fmtInteractionTarget(r.target)}</span>
                      <span className="block text-xs text-gray-500">
                        {r.route}
                        {r.mobileShare !== null ? `, ${fmtPct(r.mobileShare)} mobile` : ""}
                        {r.script && r.script !== "app" ? `, ${r.script} script` : ""}
                      </span>
                    </th>
                    <td className={`text-right py-2 px-3 font-semibold ${RATING_CLASS[r.rating] ?? "text-gray-500"}`}>
                      {fmtVital("INP", r.p75)}
                    </td>
                    <td className="text-right py-2 px-3 text-gray-300">
                      {fmtInt(r.slow)}/{fmtInt(r.samples)}
                    </td>
                    <td className="text-left py-2 pl-3 text-gray-300">
                      {r.phase ? `${r.phase.label} (${fmtVital("INP", r.phase.ms)})` : "Not reported"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-5 mt-5">
        <Stat label="Uncaught errors" value={fmtInt(speed.errors.client)} detail="Max 3 per page load, includes today" />
        <Stat label="Error screens shown" value={fmtInt(speed.errors.boundary)} detail="Crash fallback rendered" />
      </div>
      {speed.errorKinds.length > 0 && (
        <ul className="mt-4 text-sm space-y-1" aria-label="Errors by type">
          {speed.errorKinds.map((e) => (
            <li key={`${e.kind}|${e.name}|${e.route}`} className="flex justify-between gap-3 tabular-nums">
              <span className="text-gray-300">
                {e.name}
                <span className="text-gray-500"> on {e.route}{e.kind === "boundary" ? ", error screen" : ""}</span>
              </span>
              <span className="text-white font-semibold">{fmtInt(e.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The stats dashboard. Rendered only after `checkKey` accepted the key: both
 * queries throw on a bad key, and StatsPage wraps this in an error boundary
 * that sends the viewer back to the key prompt if the key stops working.
 */
export default function Dashboard({ adminKey }) {
  const [windowDays, setWindowDays] = useState(7);
  const liveRaw = useQuery(api.stats.getLive, { adminKey });
  const dashboardRaw = useQuery(api.stats.getDashboard, { adminKey, days: windowDays });

  const live = useMemo(() => normalizeLive(liveRaw), [liveRaw]);
  const dashboard = useMemo(() => normalizeDashboard(dashboardRaw, windowDays), [dashboardRaw, windowDays]);
  const hourly = dashboard.hourly.length ? dashboard.hourly : live.hourly;

  // "Today so far" comes with the dashboard payload; keep the last one on
  // screen while a window switch reloads, instead of flashing a loader.
  const [today, setToday] = useState({ loaded: false, value: null });
  useEffect(() => {
    if (dashboardRaw !== undefined) setToday({ loaded: true, value: dashboard.today ?? live.today });
  }, [dashboardRaw, dashboard.today, live.today]);

  return (
    <div className="space-y-5">
      {liveRaw === undefined ? (
        <Card title="Live now">
          <EmptyNote>Loading…</EmptyNote>
        </Card>
      ) : (
        <LiveNow live={live} />
      )}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {liveRaw === undefined ? (
          <Card title="All-time peak">
            <EmptyNote>Loading…</EmptyNote>
          </Card>
        ) : (
          <AllTimePeak peak={live.peak} />
        )}
        {today.loaded ? (
          <TodaySoFar today={today.value} />
        ) : (
          <Card title="Today so far">
            <EmptyNote>Loading…</EmptyNote>
          </Card>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-4">
        <h2 className="text-xl font-bold text-white">Trends</h2>
        <WindowToggle value={windowDays} onChange={setWindowDays} />
      </div>

      {dashboardRaw === undefined ? (
        <Card>
          <EmptyNote>Loading {windowDays} days…</EmptyNote>
        </Card>
      ) : (
        <>
          <Trends dashboard={dashboard} windowDays={windowDays} />
          <HourlyCurve hourly={hourly} />
          <QuickPlay qp={dashboard.quickPlay} windowDays={windowDays} />
          <Speed speed={dashboard.speed} windowDays={windowDays} />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Funnel funnel={dashboard.funnel} windowDays={windowDays} />
            <Retention retention={dashboard.retention} />
            <Abandonment rows={dashboard.abandonment} />
            <Searches searches={dashboard.searches} noResultRows={dashboard.noResultSearches} windowDays={windowDays} />
          </div>
        </>
      )}
    </div>
  );
}
