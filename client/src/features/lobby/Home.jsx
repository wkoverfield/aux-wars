import React, { useState, useEffect } from "react";
import AnimatedLogo from "../../components/AnimatedLogo";
import HomeBtn from "../../components/HomeBtn";
import HowToPlayModal from "../../components/HowToPlayModal";
import DevBtn from "../../components/DevBtn";
import { useNavigate } from "react-router-dom";
import { useSocket } from "../../services/SocketProvider";
// No authentication needed for YouTube

/**
 * Home component serves as the landing page for the game.
 * Provides options to host a new game or join an existing one.
 * No authentication required with YouTube API.
 * 
 * @returns {JSX.Element} Rendered component
 */
export default function Home() {
  const socket = useSocket();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [isHosting, setIsHosting] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  // No authentication check needed for YouTube

  /**
   * Handles hosting a new game.
   * Creates a new game room.
   * Emits host-game event and navigates to lobby on success.
   * Disables hosting button while request is in progress.
   */
  const handleHostGame = () => {
    if (!socket || isHosting) return;
    
    // No authentication check needed
    
    setIsHosting(true);
    socket.emit("host-game", (response) => {
      if (response.success) {
        navigate(`/lobby/${response.gameCode}`);
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
    if (!socket || !joinCode.trim()) {
      alert("Please enter a valid game code.");
      return;
    }

    // No authentication check needed
    
    socket.emit("join-game", { gameCode: joinCode.trim() }, (response) => {
      if (response.success) {
        navigate(`/lobby/${joinCode.trim()}`);
      } else {
        alert(response.message || "Failed to join game.");
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
