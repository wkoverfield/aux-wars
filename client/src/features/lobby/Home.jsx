import React, { useState, useEffect } from "react";
import AnimatedLogo from "../../components/AnimatedLogo";
import HomeBtn from "../../components/HomeBtn";
import FeedbackModal from "../../components/FeedbackModal";
import GitHubStarButton from "../../components/GitHubStarButton";
import AdSlot from "../../components/AdSlot";
import NewsSection from "../../components/NewsSection";
import { useNavigate } from "react-router-dom";
import { useMutation, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useSession } from "../../hooks/useSession";
import { useToast } from "../../contexts/ToastContext";
import { getProToken, useIsPro } from "../../services/pro";
import { adsConfigured } from "../../services/ads";

const HOW_TO_PLAY = [
  { n: 1, title: "Host a game", text: "Create a room and share the code with your friends." },
  { n: 2, title: "Get a prompt", text: "Like “song that makes you wanna text your ex.”" },
  { n: 3, title: "Pick a song", text: "Search and drop the perfect track for the prompt." },
  { n: 4, title: "Rate the picks", text: "Listen to everyone’s songs and vote 1–5." },
  { n: 5, title: "Crown the winner", text: "Best average rating takes the round." },
];

/**
 * Home — landing page. Scrollable, skribbl-style: a hero play area above the
 * fold, then About / News / How-to-Play sections below.
 */
export default function Home() {
  const hostGame = useMutation(api.game.rooms.hostGame);
  const joinGame = useMutation(api.game.rooms.joinGame);
  const createCheckout = useAction(api.stripe.createCheckoutSession);
  const logEvent = useMutation(api.analytics.logEvent);
  const navigate = useNavigate();
  const { connectionId, clearSession, createSession, session, isSessionValid } = useSession();
  const { showToast } = useToast();
  const isPro = useIsPro();
  const [joinCode, setJoinCode] = useState("");
  const [isHosting, setIsHosting] = useState(false);
  const [goingPro, setGoingPro] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  // Clear expired sessions on mount
  useEffect(() => {
    if (session && !isSessionValid()) {
      clearSession();
    }
  }, [session, isSessionValid, clearSession]);

  // Pro funnel (only when the offer is actually visible) + new/returning signal.
  useEffect(() => {
    if (adsConfigured() && !isPro) logEvent({ eventType: "pro_cta_viewed" });
    try {
      const seen = localStorage.getItem("aux-wars-seen");
      logEvent({ eventType: "session_start", metadata: { label: seen ? "returning" : "new" } });
      if (!seen) localStorage.setItem("aux-wars-seen", String(Date.now()));
    } catch { /* ignore storage errors */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleHostGame = async () => {
    if (isHosting) return;
    setIsHosting(true);
    clearSession();
    try {
      const { code } = await hostGame({ proToken: getProToken() || undefined });
      const playerId = crypto.randomUUID();
      const tempName = "Host";
      const joinResp = await joinGame({ code, name: tempName, playerId, connectionId });
      if (joinResp?.success) {
        createSession({ gameCode: code, playerId, playerName: tempName, lastPhase: "lobby" });
        navigate(`/lobby/${code}`);
      } else {
        showToast("Failed to join hosted game", "error");
      }
    } catch (e) {
      showToast("Failed to host game", "error");
    } finally {
      setIsHosting(false);
    }
  };

  const handleGoPro = async () => {
    if (goingPro) return;
    setGoingPro(true);
    logEvent({ eventType: "pro_checkout_started" });
    try {
      const { url } = await createCheckout({ origin: window.location.origin });
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("No checkout URL");
      }
    } catch (e) {
      showToast("Couldn't start checkout. Please try again.", "error");
      setGoingPro(false);
    }
  };

  const handleJoinGame = async () => {
    if (!joinCode.trim()) {
      showToast("Please enter a valid game code.", "warning");
      return;
    }
    const code = joinCode.trim().toUpperCase();

    if (session?.gameCode === code && session?.playerId && isSessionValid()) {
      navigate(`/lobby/${code}`);
      return;
    }

    clearSession();
    const playerId = crypto.randomUUID();
    const tempName = `Player ${Math.floor(Math.random() * 100) + 1}`;

    try {
      const resp = await joinGame({ code, name: tempName, playerId, connectionId });
      if (resp?.success) {
        createSession({ gameCode: code, playerId, playerName: tempName, lastPhase: "lobby" });
        navigate(`/lobby/${code}`);
      } else {
        showToast(resp?.message || "Failed to join game.", "error");
      }
    } catch (e) {
      showToast("Failed to join game.", "error");
    }
  };

  return (
    <div className="home h-full overflow-y-auto flex flex-col items-center relative z-20">
      {/* SEO heading (indexed; logo is the visual title) */}
      <h1 className="sr-only">Aux Wars — Free Online Music Party Game with Friends</h1>

      {/* Play area — natural height, stacks directly above the sections (skribbl-style) */}
      <section className="w-full flex flex-col items-center px-4 pt-3">
        <div className="home-top flex flex-col items-center mt-2 mb-6">
          <AnimatedLogo />
          {/* <p className="text-white/60 text-sm md:text-base italic text-center px-6 -mt-2 mb-6">
            settle music taste arguments with your friends
          </p> */}
          <div className="home-join flex flex-col items-center gap-8 w-full max-w-xs">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Enter Code"
              className="join-code text-center text-2xl py-3 text-white"
            />
          </div>
        </div>

        <div className="home-btns flex flex-col items-center gap-5 w-full max-w-xs">
          <HomeBtn onClick={handleJoinGame} className="spotify-btn" text="Join game" />
          <HomeBtn
            onClick={handleHostGame}
            className="guest-btn"
            text={isHosting ? "Hosting..." : "Host game"}
            disabled={isHosting}
          />
        </div>

        {/* Pro CTA — only once ads are live (otherwise "ad-free" is meaningless) */}
        {adsConfigured() && (isPro ? (
          <span className="mt-5 text-xs text-[#68d570] font-semibold">
            ★ Pro unlocked — your games are ad-free
          </span>
        ) : (
          <div className="mt-5 flex flex-col items-center gap-1">
            <button
              onClick={handleGoPro}
              disabled={goingPro}
              className="text-sm text-[#68d570] hover:underline disabled:opacity-60"
            >
              {goingPro ? "Opening checkout…" : "Go Pro — ad-free + bigger rooms ($5)"}
            </button>
            <button
              onClick={() => navigate("/pro/restore")}
              className="text-xs text-gray-400 hover:underline"
            >
              Already Pro? Restore
            </button>
          </div>
        ))}

      </section>

      {/* About / News / How to Play — stacked right below the play area */}
      <section className="w-full max-w-5xl px-4 pt-10 pb-8 grid gap-5 md:grid-cols-3">
        {/* About */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-xl font-bold text-white mb-3">About</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            <strong className="text-white">Aux Wars</strong> is a free online music party game.
            Get a prompt, pick the perfect song, rate everyone&rsquo;s picks, and crown the winner.
          </p>
          <p className="text-sm text-gray-400 leading-relaxed mt-3">
            No signups, no downloads — just share a code and play with friends on any device.
          </p>
        </div>

        {/* News */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-xl font-bold text-white mb-3">News</h2>
          <NewsSection />
        </div>

        {/* How to Play */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-xl font-bold text-white mb-3">How to Play</h2>
          <ol className="space-y-3">
            {HOW_TO_PLAY.map((step) => (
              <li key={step.n} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#68d570] text-black text-sm font-bold flex items-center justify-center">
                  {step.n}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{step.title}</p>
                  <p className="text-sm text-gray-400">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Ad-safe surface (dark until AdSense is live) */}
      <AdSlot slot="home" className="max-w-xl" />

      {/* Footer — one consolidated row */}
      <footer className="dev-links flex items-center gap-4 flex-wrap justify-center py-8">
        <GitHubStarButton />
        <a
          href="https://buymeacoffee.com/wkoverfield"
          target="_blank"
          rel="noopener noreferrer"
          className="dev-btn flex rounded-full items-center justify-center cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-1">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
          <p className="text-xs">Support</p>
        </a>
        <button
          onClick={() => setShowFeedback(true)}
          className="dev-btn flex rounded-full items-center justify-center cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-1">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
          </svg>
          <p className="text-xs">Leave Feedback</p>
        </button>
      </footer>

      <FeedbackModal showModal={showFeedback} onClose={() => setShowFeedback(false)} />
    </div>
  );
}
