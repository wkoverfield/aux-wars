import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString() : "—";
}

/**
 * Live social-proof counters for the homepage. Reactive — the numbers tick up
 * in real time as games are played. Reads the all-time analytics aggregates.
 */
export default function LiveStats() {
  const stats = useQuery(api.analytics.getAllAggregates);
  if (!stats) return null;

  const items = [
    { value: stats.game_started, label: "games played" },
    { value: stats.player_joined, label: "players" },
    { value: stats.rating_submitted, label: "songs rated" },
  ].filter((i) => typeof i.value === "number" && i.value > 0);

  if (items.length === 0) return null;

  return (
    <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="text-sm text-gray-400">
          <strong className="text-[#68d570]">{fmt(i.value)}</strong> {i.label}
        </span>
      ))}
    </div>
  );
}
