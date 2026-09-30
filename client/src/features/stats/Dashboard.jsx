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
  normalizeDashboard,
  normalizeLive,
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

function NoResultSearches({ rows }) {
  return (
    <Card title="Top searches with no results">
      <RankedBars
        rows={rows.slice(0, 10).map((r) => ({ key: r.label, label: r.label, value: r.count }))}
        format={fmtInt}
        emptyText="No empty searches in this window."
      />
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
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Funnel funnel={dashboard.funnel} windowDays={windowDays} />
            <Retention retention={dashboard.retention} />
            <Abandonment rows={dashboard.abandonment} />
            <NoResultSearches rows={dashboard.noResultSearches} />
          </div>
        </>
      )}
    </div>
  );
}
