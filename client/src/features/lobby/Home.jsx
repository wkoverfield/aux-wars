import React, { useState, useEffect } from "react";
import AnimatedLogo from "../../components/AnimatedLogo";
import HomeBtn from "../../components/HomeBtn";
import HowToPlayModal from "../../components/HowToPlayModal";
import DevBtn from "../../components/DevBtn";
import { useNavigate } from "react-router-dom";
import { useSocket, useSocketConnection } from "../../services/SocketProvider";
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
  const socket = useSocket();
  const isConnected = useSocketConnection();
  const navigate = useNavigate();
  const { clearSession, createSession } = useSession();
  const { showToast } = useToast();
  const [joinCode, setJoinCode] = useState("");
  const [isHosting, setIsHosting] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  // Clear session when landing on home page
  useEffect(() => {
    clearSession();
  }, [clearSession]);

  /**
   * Handles hosting a new game.
   * Creates a new game room.
   * Emits host-game event and navigates to lobby on success.
   * Disables hosting button while request is in progress.
   */
  const handleHostGame = () => {
    if (!socket || !isConnected || isHosting) return;
    
    // No authentication check needed
    
    setIsHosting(true);
    socket.emit("host-game", (response) => {
      if (response.success) {
        // First host the game, then join it
        const playerId = crypto.randomUUID();
        const tempName = "Host"; // Give host a temporary name
        socket.emit("join-game", { 
          gameCode: response.gameCode, 
          name: tempName, 
          playerId: playerId 
        }, (joinResponse) => {
          if (joinResponse.success) {
            // Create session before navigating
            createSession({
              gameCode: response.gameCode,
              playerId: playerId,
              playerName: tempName,
              lastPhase: 'lobby'
            });
            navigate(`/lobby/${response.gameCode}`);
          } else {
            setIsHosting(false);
            showToast("Failed to join hosted game", "error");
          }
        });
      } else {
        setIsHosting(false);
      }
    });
  };

  /**
   * Handles joining an existing game.
   * Creates a new game room.
   * Validates game code and emits join-game event.
   * Shows error message if join fails.
   */
  const handleJoinGame = () => {
    if (!socket || !isConnected) {
      showToast("Please wait for connection to establish.", "warning");
      return;
    }
    
    if (!joinCode.trim()) {
      showToast("Please enter a valid game code.", "warning");
      return;
    }

    // No authentication check needed
    const playerId = crypto.randomUUID();
    // Generate a temporary player name
    const tempName = `Player ${Math.floor(Math.random() * 100) + 1}`;
    
    socket.emit("join-game", { 
      gameCode: joinCode.trim(), 
      name: tempName,
      playerId: playerId 
    }, (response) => {
      if (response.success) {
        // Create session before navigating
        createSession({
          gameCode: joinCode.trim(),
          playerId: playerId,
          playerName: tempName,
          lastPhase: 'lobby'
        });
        navigate(`/lobby/${joinCode.trim()}`);
      } else {
        showToast(response.message || "Failed to join game.", "error");
      }
    });
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
        {!isConnected && (
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
          disabled={!isConnected}
        />
        <HomeBtn 
          onClick={handleHostGame} 
          className="guest-btn" 
          text={isHosting ? "Hosting..." : "Host game"} 
          disabled={isHosting || !isConnected}
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
