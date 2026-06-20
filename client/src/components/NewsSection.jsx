import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import ScrollFade from "./ScrollFade";

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * Homepage News list — reads published updates from Convex (api.news.getRecentNews).
 * Post updates with: npx convex run news:addNews '{"title":"...","body":"..."}'
 */
export default function NewsSection() {
  const news = useQuery(api.news.getRecentNews, { limit: 8 });

  if (news === undefined) {
    return <p className="text-gray-400 text-sm">Loading…</p>;
  }
  if (news.length === 0) {
    return <p className="text-gray-400 text-sm">No updates yet — stay tuned!</p>;
  }

  return (
    <ScrollFade className="" scrollClassName="max-h-80 w-full" contentClassName="space-y-4 pr-1">
      {news.map((n) => (
        <div key={n.id}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold text-white">{n.title}</h3>
            <span className="text-xs text-gray-500 shrink-0">{formatDate(n.publishedAt)}</span>
          </div>
          <p className="text-sm text-gray-300 whitespace-pre-line mt-1">{n.body}</p>
        </div>
      ))}
    </ScrollFade>
  );
}
