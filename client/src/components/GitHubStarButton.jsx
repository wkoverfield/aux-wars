import { useEffect, useState } from "react";

const REPO_URL = "https://github.com/woverfield/aux-wars";
const API_URL = "https://api.github.com/repos/woverfield/aux-wars";
const CACHE_KEY = "github_stars_aux_wars";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour — keeps us well under GitHub's 60 req/hr unauth limit

/**
 * "Star on GitHub" button that fetches and displays the live star count.
 * Caches the count in localStorage for 1 hour to stay within GitHub's
 * unauthenticated API rate limit. Falls back gracefully to no count
 * on any error, so the button always works as a link.
 */
export default function GitHubStarButton() {
  const [stars, setStars] = useState(null);

  useEffect(() => {
    // Try cache first
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { count, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          setStars(count);
          return;
        }
      }
    } catch {
      // ignore cache errors — proceed to fetch
    }

    let cancelled = false;
    fetch(API_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const count = data.stargazers_count ?? 0;
        setStars(count);
        try {
          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ count, timestamp: Date.now() })
          );
        } catch {
          // ignore storage errors
        }
      })
      .catch(() => {
        // fail silently — link still works without the count
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="dev-btn flex rounded-full items-center justify-center cursor-pointer"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-4 h-4 mr-1"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
        />
      </svg>
      <p className="text-xs">
        Star on GitHub
        {stars !== null && stars > 0 && (
          <span className="ml-1 opacity-80">· {stars.toLocaleString()}</span>
        )}
      </p>
    </a>
  );
}
