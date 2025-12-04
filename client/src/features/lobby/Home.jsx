import React, { useState, useEffect } from "react";
import AnimatedLogo from "../../components/AnimatedLogo";
import HomeBtn from "../../components/HomeBtn";
import HowToPlayModal from "../../components/HowToPlayModal";
import DevBtn from "../../components/DevBtn";
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
      {/* Top section with logo and join code input */}
      <div className="home-top flex flex-col items-center my-10">
        <AnimatedLogo />
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
        <button 
          onClick={() => setShowHowToPlay(true)}
          className="text-sm md:text-base text-white hover:underline transition-colors"
        >
          How to play
        </button>
        <div className="dev-links">
          <DevBtn />
        </div>
      </div>

      <HowToPlayModal 
        showModal={showHowToPlay}
        onClose={() => setShowHowToPlay(false)}
      />
    </div>
  );
}
