import React, { useState, useEffect } from "react";
import AnimatedLogo from "../../components/AnimatedLogo";
import HomeBtn from "../../components/HomeBtn";
import HowToPlayModal from "../../components/HowToPlayModal";
import FeedbackModal from "../../components/FeedbackModal";
import DevBtn from "../../components/DevBtn";
import GitHubStarButton from "../../components/GitHubStarButton";
import { useNavigate } from "react-router-dom";
// import { useSocket, useSocketConnection } from "../../services/SocketProvider";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useSession } from "../../hooks/useSession";
import { useToast } from "../../contexts/ToastContext";

/**
 * Home component serves as the landing page for the game.
 * Provides options to host a new game or join an existing one.
 * No authentication required with YouTube API.
 * 
 * @returns {JSX.Element} Rendered component
 */
export default function Home() {
  // const socket = useSocket();
  // const isConnected = useSocketConnection();
  const hostGame = useMutation(api.game.rooms.hostGame);
  const joinGame = useMutation(api.game.rooms.joinGame);
  const navigate = useNavigate();
  const { connectionId, clearSession, createSession, session, isSessionValid } = useSession();
  const { showToast } = useToast();
  const [joinCode, setJoinCode] = useState("");
  const [isHosting, setIsHosting] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  // Clear expired sessions on mount
  useEffect(() => {
    if (session && !isSessionValid()) {
      clearSession();
    }
  }, [session, isSessionValid, clearSession]);

  /**
   * Handles hosting a new game.
   * Creates a new game room.
   * Emits host-game event and navigates to lobby on success.
   * Disables hosting button while request is in progress.
   */
  const handleHostGame = async () => {
    if (isHosting) return;
    setIsHosting(true);
    // Clear any existing session when starting a new game
    clearSession();
    try {
      const { code } = await hostGame();
      const playerId = crypto.randomUUID();
      const tempName = "Host";
      const joinResp = await joinGame({ code, name: tempName, playerId, connectionId });
      if (joinResp?.success) {
        createSession({ gameCode: code, playerId, playerName: tempName, lastPhase: 'lobby' });
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

  /**
   * Handles joining an existing game.
   * Creates a new game room.
   * Validates game code and emits join-game event.
   * Shows error message if join fails.
   */
  const handleJoinGame = async () => {
    if (!joinCode.trim()) {
      showToast("Please enter a valid game code.", "warning");
      return;
    }

    const code = joinCode.trim().toUpperCase();
    
    // Check if user is trying to rejoin a game they're already in
    if (session?.gameCode === code && session?.playerId && isSessionValid()) {
      // They're rejoining their current game - navigate directly
      navigate(`/lobby/${code}`);
      return;
    }
    
    // Save current session for potential recovery
    const previousSession = session;
    
    // Clear any existing session when joining a NEW game
    clearSession();
    const playerId = crypto.randomUUID();
    const tempName = `Player ${Math.floor(Math.random() * 100) + 1}`;

    try {
      const resp = await joinGame({ code, name: tempName, playerId, connectionId });
      if (resp?.success) {
        createSession({ gameCode: code, playerId, playerName: tempName, lastPhase: 'lobby' });
        navigate(`/lobby/${code}`);
      } else {
        // Show error - user can try again or start fresh
        showToast(resp?.message || "Failed to join game.", "error");
        // Note: We don't restore previousSession here because:
        // 1. If they were trying to join a different game, restoring would be wrong
        // 2. If join failed, they should start fresh anyway
        // 3. They can always navigate back if they had a valid session
      }
    } catch (e) {
      showToast("Failed to join game.", "error");
      // Same reasoning - let them start fresh on error
    }
  };

  // No authentication check needed for YouTube

  return (
    <div className="home h-svh flex flex-col items-center relative z-20">
      {/* Top section with logo, tagline, and join code input */}
      <div className="home-top flex flex-col items-center my-10">
        <AnimatedLogo />
        <p className="text-white/60 text-sm md:text-base italic text-center px-6 -mt-2 mb-6">
          settle music taste arguments with your friends
        </p>
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

      {/* SEO content - indexed by Google, hidden from view */}
      <h1 className="sr-only">Aux Wars — Free Online Music Party Game with Friends</h1>
      <p className="sr-only">
        Free online music party game. Pick songs for creative prompts, rate your friends' picks, crown the winner. No download, no login required. Play with 3-8 friends on any device.
      </p>

      {/* Bottom section with action buttons */}
      <div className="home-btns flex flex-col items-center gap-6 mb-10 w-full h-full max-w-xs justify-between">
        {false && (
          <div className="text-white text-sm mb-2 text-center">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Connecting to server...</span>
            </div>
          </div>
        )}
        <HomeBtn 
          onClick={handleJoinGame} 
          className="spotify-btn" 
          text="Join game" 
        />
        <HomeBtn 
          onClick={handleHostGame} 
          className="guest-btn" 
          text={isHosting ? "Hosting..." : "Host game"} 
          disabled={isHosting}
        />
      </div>

      {/* How to Play button and dev credits */}
      <div className="flex flex-col items-center gap-4 pb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowHowToPlay(true)}
            className="text-sm md:text-base text-white hover:underline transition-colors"
          >
            How to play
          </button>
          <span className="text-gray-500">•</span>
          <button
            onClick={() => setShowFeedback(true)}
            className="text-sm md:text-base text-white hover:underline transition-colors"
          >
            Leave Feedback
          </button>
        </div>
        <div className="dev-links flex items-center gap-3 flex-wrap justify-center">
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
          <DevBtn />
        </div>
      </div>

      <HowToPlayModal
        showModal={showHowToPlay}
        onClose={() => setShowHowToPlay(false)}
      />
      <FeedbackModal
        showModal={showFeedback}
        onClose={() => setShowFeedback(false)}
      />
    </div>
  );
}
