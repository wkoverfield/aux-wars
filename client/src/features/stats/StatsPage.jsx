import { Component, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useConvex } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import Dashboard from "./Dashboard";
import { clearStoredKey, readStoredKey, writeStoredKey } from "./statsModel";

/** Keep /stats out of search indexes (the host also sends X-Robots-Tag). */
function useNoIndex() {
  useEffect(() => {
    let meta = document.head.querySelector('meta[name="robots"]');
    const created = !meta;
    const previous = meta?.getAttribute("content") ?? null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", "noindex, nofollow");
    const previousTitle = document.title;
    document.title = "Stats | Aux Wars";
    return () => {
      document.title = previousTitle;
      if (created) meta.remove();
      else if (previous !== null) meta.setAttribute("content", previous);
    };
  }, []);
}

/**
 * Catches a stats query that throws after the key was accepted (the key was
 * rotated, or the env var removed) so it never reaches the app-wide
 * ErrorBoundary.
 */
class StatsBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** How long a key check may take before the service counts as unreachable. */
export const CHECK_TIMEOUT_MS = 10_000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const MESSAGES = {
  rejected: "That key was not accepted.",
  expired: "The saved key stopped working. Paste the current one.",
  error: "Could not reach the stats service. Try again.",
};

function KeyPrompt({ onSubmit, checking, checkingSaved, message }) {
  const [value, setValue] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const key = value.trim();
    if (key && !checking) onSubmit(key);
  };

  return (
    <form onSubmit={submit} className="w-full max-w-md mx-auto bg-white/5 border border-white/10 rounded-xl p-6 mt-10">
      <h1 className="text-2xl font-bold text-white mb-1">Stats</h1>
      <p className="text-sm text-gray-400 mb-6">Paste the admin key to view usage. It is saved in this browser only.</p>
      <label htmlFor="stats-admin-key" className="block text-sm text-gray-300 mb-2">
        Admin key
      </label>
      <div className="flex gap-2">
        <input
          id="stats-admin-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 min-w-0 bg-[#181818] border border-gray-700 rounded-md px-3 py-2 text-white ph-no-capture"
        />
        <button
          type="submit"
          disabled={checking || !value.trim()}
          className="px-4 py-2 rounded-md font-semibold text-black bg-[#68d570] hover:bg-[#7de884] disabled:opacity-60"
        >
          {checking ? "Checking…" : "Unlock"}
        </button>
      </div>
      {checkingSaved && (
        <p role="status" className="text-sm mt-4 text-gray-400">
          Checking saved key…
        </p>
      )}
      {message && (
        <p role="alert" className={`text-sm mt-4 ${message === "error" ? "text-red-400" : "text-amber-400"}`}>
          {MESSAGES[message]}
        </p>
      )}
    </form>
  );
}

/**
 * /stats: private usage dashboard. Unlinked, noindex, and gated by an admin
 * key that every stats query re-checks server side. The key is verified with
 * `checkKey` before any throwing query is subscribed.
 */
export default function StatsPage() {
  useNoIndex();
  const convex = useConvex();
  const [initialKey] = useState(() => readStoredKey());
  // status: checking | prompt | ready | failed
  const [status, setStatus] = useState(initialKey ? "checking" : "prompt");
  const [adminKey, setAdminKey] = useState(null);
  const [message, setMessage] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [checkingSaved, setCheckingSaved] = useState(Boolean(initialKey));

  const verify = useCallback(
    async (key, { fromStorage = false } = {}) => {
      setStatus("checking");
      setCheckingSaved(fromStorage);
      setMessage(null);
      try {
        const result = await withTimeout(convex.query(api.stats.checkKey, { adminKey: key }), CHECK_TIMEOUT_MS);
        setCheckingSaved(false);
        if (result?.ok === true) {
          writeStoredKey(key);
          setAdminKey(key);
          setStatus("ready");
          return;
        }
        clearStoredKey();
        setMessage(fromStorage ? "expired" : "rejected");
      } catch {
        setCheckingSaved(false);
        setMessage("error");
      }
      setStatus("prompt");
    },
    [convex],
  );

  // Verify a saved key once on mount.
  const checkedSaved = useRef(false);
  useEffect(() => {
    if (checkedSaved.current || !initialKey) return;
    checkedSaved.current = true;
    verify(initialKey, { fromStorage: true });
  }, [initialKey, verify]);

  const forget = () => {
    clearStoredKey();
    setAdminKey(null);
    setMessage(null);
    setStatus("prompt");
  };

  // A stats query threw. If the key is no longer accepted, drop it and ask
  // again; otherwise keep it and offer a retry (no automatic re-subscribe, so
  // a persistent server error cannot loop).
  const onQueryFailure = useCallback(async () => {
    const key = adminKey;
    setStatus("checking");
    try {
      const result = await withTimeout(convex.query(api.stats.checkKey, { adminKey: key }), CHECK_TIMEOUT_MS);
      if (result?.ok !== true) {
        clearStoredKey();
        setAdminKey(null);
        setMessage("expired");
        setStatus("prompt");
        return;
      }
    } catch {
      /* unreachable service: keep the key and offer a retry */
    }
    setStatus("failed");
  }, [adminKey, convex]);

  const retry = () => {
    setAttempt((n) => n + 1);
    setStatus("ready");
  };

  return (
    <div className="min-h-svh w-full bg-[#121212] text-white ph-no-capture">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {(status === "ready" || status === "failed") && adminKey ? (
          <>
            <header className="flex items-center justify-between gap-3 mb-6">
              <div>
                <h1 className="text-3xl font-bold">Aux Wars stats</h1>
                <p className="text-sm text-gray-400">Counts from Convex rollups. All days and times are UTC.</p>
              </div>
              <button
                type="button"
                onClick={forget}
                className="text-sm text-gray-400 hover:text-white underline shrink-0"
              >
                Forget key
              </button>
            </header>
            {status === "failed" ? (
              <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
                <p className="text-gray-300 mb-4">The dashboard could not load. The key is still valid.</p>
                <button
                  type="button"
                  onClick={retry}
                  className="px-6 py-2 rounded-full font-semibold text-black bg-[#68d570] hover:bg-[#7de884]"
                >
                  Retry
                </button>
              </div>
            ) : (
              <StatsBoundary key={`${adminKey}:${attempt}`} onFail={onQueryFailure}>
                <Dashboard adminKey={adminKey} />
              </StatsBoundary>
            )}
          </>
        ) : (
          <>
            <KeyPrompt
              onSubmit={(key) => verify(key)}
              checking={status === "checking"}
              checkingSaved={status === "checking" && checkingSaved}
              message={message}
            />
            <div className="text-center mt-8">
              <Link to="/" className="text-gray-400 underline text-sm">Back to Aux Wars</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
