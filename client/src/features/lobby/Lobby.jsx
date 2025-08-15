import React, { useState, useEffect, useRef } from "react";
import { useSocket, useSocketConnection } from "../../services/SocketProvider";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import PlayerList from "../../components/PlayerList";
import SettingsModal from "../../components/SettingsModal";
import { useGame } from "../../services/GameContext";
import { useSession } from "../../hooks/useSession";
import { useToast } from "../../contexts/ToastContext";
import logo from "../../assets/aux-wars-logo.svg";
import settingsIcon from "../../assets/settings-btn.svg";

/**
 * Lobby component manages the game lobby where players can join, set their names,
 * and prepare for the game. Handles game settings, player management, and game start.
 * 
 * @returns {JSX.Element} Rendered component
 */
export default function Lobby() {
  const socket = useSocket();
  const navigate = useNavigate();
  const { gameCode: routeGameCode } = useParams();
  const { dispatch } = useGame();
  const { session, createSession, updateSession, clearSession } = useSession();
  const { showToast } = useToast();
  const [players, setPlayers] = useState([]);
  const [gameCode, setGameCode] = useState(routeGameCode || "");
  const [name, setName] = useState(session?.playerName || "");
  const [isReady, setIsReady] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [animateInput, setAnimateInput] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const allPlayersReady = players.every((player) => player.isReady);
  const isConnected = useSocketConnection();
  const hasJoinedGame = useRef(false);

  // Join game only once when component mounts
  useEffect(() => {
    if (!socket || hasJoinedGame.current) {
      return;
    }

    // Check if we have a valid session and are already joined
    if (session && session.gameCode === routeGameCode) {
      hasJoinedGame.current = true;
      setGameCode(routeGameCode);
      setName(session.playerName || "");
      // We've already joined from Home, no need to rejoin
      return;
    }

    const joinGame = (code, initialName = "") => {
      const playerId = session?.playerId || crypto.randomUUID();
      
      socket.emit("join-game", { gameCode: code, name: initialName, playerId }, (response) => {
        if (!response.success) {
          navigate("/");
        } else {
          // Create or update session
          createSession({
            playerId: response.playerId || playerId,
            gameCode: code,
            playerName: initialName,
            lastPhase: 'lobby'
          });
          
          if (response.settings) {
            // Apply the game settings from the host
            dispatch({ type: "SET_ROUNDS", payload: response.settings.numberOfRounds });
            dispatch({ type: "SET_ROUND_LENGTH", payload: response.settings.roundLength });
            dispatch({ type: "SET_SELECTED_PROMPTS", payload: response.settings.selectedPrompts });
          }
          
          hasJoinedGame.current = true;
        }
      });
    };

    if (!routeGameCode) {
      // This shouldn't happen since we join from Home now
      navigate("/");
    } else {
      // Join existing game - but this should already be done from Home
      setGameCode(routeGameCode);
      joinGame(routeGameCode, name);
    }
  }, [socket, routeGameCode, navigate, session, createSession, dispatch, name]);

  // Set up socket event listeners
  useEffect(() => {
    if (!socket) {
      navigate("/");
      return;
    }

    // Set up event listener for player updates
    const handleUpdatePlayers = (updatedPlayers) => setPlayers(updatedPlayers);
    socket.on("update-players", handleUpdatePlayers);

    // Cleanup function to remove event listeners
    return () => {
      socket.off("update-players", handleUpdatePlayers);
    };
  }, [socket, navigate]);

  // Update host status when players change
  useEffect(() => {
    const currentPlayer = players.find((player) => player.id === socket?.id);
    if (currentPlayer) {
      setIsHost(currentPlayer.isHost);
      // Don't sync ready state from server to avoid infinite loops
      // Local state should be the source of truth for user-controlled actions
    }
  }, [players, socket]);

  // Update player's name and ready status
  useEffect(() => {
    // Always emit player updates when name or ready status changes
    if (gameCode && socket) {
      socket.emit("update-player-name", { gameCode, name, isReady });
      // Update session with new name
      if (session && name !== session.playerName) {
        updateSession({ playerName: name });
      }
    }
  }, [name, isReady]);

  // Listen for game settings updates from the server
  useEffect(() => {
    if (!socket) return;
    socket.on("game-settings-updated", (updatedSettings) => {
      dispatch({ type: "SET_ROUNDS", payload: updatedSettings.numberOfRounds });
      dispatch({
        type: "SET_ROUND_LENGTH",
        payload: updatedSettings.roundLength,
      });
      dispatch({
        type: "SET_SELECTED_PROMPTS",
        payload: updatedSettings.selectedPrompts,
      });
    });
    return () => socket.off("game-settings-updated");
  }, [socket, dispatch]);

  // Listen for phase updates
  useEffect(() => {
    if (!socket) return;
    socket.on("game-phase-updated", ({ phase }) => {
      // GameRouteGuard will handle navigation based on phase
      dispatch({ type: "SET_PHASE", payload: phase });
    });
    return () => socket.off("game-phase-updated");
  }, [socket, dispatch]);

  // Listen for "game-started" event and update current prompt
  useEffect(() => {
    if (!socket) return;
    socket.on("game-started", (data = {}) => {
      const { prompt } = data;
      if (prompt) {
        dispatch({ type: "SET_CURRENT_PROMPT", payload: prompt });
      }
      // Navigation will be handled by phase update
    });
    return () => socket.off("game-started");
  }, [socket, dispatch]);

  /**
   * Handles leaving the game and returning to home
   */
  const handleLeaveGame = () => {
    if (gameCode) {
      socket.emit("leave-game", { gameCode });
      clearSession(); // Clear the session when leaving
      navigate("/lobby", { replace: true });
    }
  };

  const pulseAnimation = {
    scale: [1, 1.05, 1],
    transition: { duration: 1, repeat: 3, ease: "easeInOut" },
  };

  /**
   * Handles toggling player ready status
   */
  const handleReady = () => {
    if (!name.trim()) {
      showToast("Please set your nickname before readying up.", "warning");
      return;
    }
    setIsReady((prev) => !prev);
    // The useEffect will handle emitting the update
  };

  /**
   * Handles starting the game with validation checks
   */
  const handleStartGame = () => {
    
    if (!socket) {
      return;
    }

    if (!isConnected) {
      // Try to reconnect the socket
      socket.connect();
      // Wait a moment for the connection to establish
      setTimeout(() => {
        if (socket.connected) {
          socket.emit("start-game", { gameCode });
        } else {
        }
      }, 1000);
      return;
    }

    if (!isHost) {
      return;
    }

    if (!allPlayersReady) {
      return;
    }

    if (players.length < 3) {
      return;
    }

    socket.emit("start-game", { gameCode });
  };

  return (
    <>
      <div
        className={`player-lobby h-screen flex flex-col w-full ${
          showModal ? "blur-sm" : ""
        }`}
      >
        <div className="lobby-header flex justify-between items-center mt-10 container mx-auto p-5">
          <div className="lobby-header-left flex items-center gap-2">
            <img src={logo} alt="Logo" className="min-w-10" />
            <p className="text-2xl text-white">Lobby</p>
          </div>
          <motion.div
            initial={{ scale: 1 }}
            whileHover={{ scale: 1.05 }}
            transition={{ type: "spring", stiffness: 300, damping: 15 }}
          >
            <button
              className="green-btn rounded-full py-2 px-4 font-semibold"
              onClick={handleLeaveGame}
            >
              <p className="text-xs md:text-sm">Leave Lobby</p>
            </button>
          </motion.div>
        </div>
        <div className="lobby-body flex-1 flex flex-col min-h-0">
          <div className="lobby-info flex flex-col sm:items-start container mx-auto px-5 py-4 text-white gap-10 flex-1 min-h-0">
            <p className="text-xl">Nickname:</p>
            <div className="flex flex-col gap-5 w-full">
              <motion.input
                type="text"
                className="w-full rounded-md"
                placeholder="Enter your nickname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                animate={animateInput ? pulseAnimation : {}}
              />
              <div className="lobby-code-count flex gap-5">
                <div className="lobby-container rounded-md lobby-code flex flex-col gap-2">
                  <p className="text-xs font-normal">Code</p>
                  <p className="text-2xl">{gameCode}</p>
                </div>
                <div className="lobby-container rounded-md lobby-count flex flex-col gap-2">
                  <p className="text-xs font-normal">Players</p>
                  <p className="text-2xl">{players.length}/8</p>
                </div>
              </div>
              <div className="flex flex-col items-center gap-5">
                <motion.div
                  className="w-full flex items-center justify-center"
                  initial={{ scale: 1 }}
                  whileHover={{ scale: 1.05 }}
                  transition={{ type: "spring", stiffness: 300, damping: 15 }}
                >
                  <button
                    className={
                      isReady
                        ? "green-btn rounded-full py-2 px-8 text-black font-semibold w-full max-w-md"
                        : "bg-white rounded-full py-2 px-8 text-black w-full max-w-md font-semibold"
                    }
                    onClick={handleReady}
                  >
                    <p className="text-sm md:text-base">
                      {isReady ? "Ready" : "Not Ready"}
                    </p>
                  </button>
                </motion.div>
              </div>
            </div>
            <div className="flex w-full items-center justify-between">
              <p className="text-center text-2xl">Players</p>
              <button onClick={() => setShowModal(true)}>
                <img src={settingsIcon} alt="Settings" className="min-w-6" />
              </button>
            </div>
            <div className="flex-1 w-full overflow-y-auto min-h-0">
              <PlayerList players={players} />
            </div>
          </div>
          {isHost && allPlayersReady && players.length > 2 && (
            <button
              className="green-btn fixed bottom-0 w-full text-black py-3 text-center"
              onClick={handleStartGame}
            >
              Start Game
            </button>
          )}
        </div>
      </div>
      <SettingsModal
        showModal={showModal}
        onClose={() => setShowModal(false)}
        gameCode={gameCode}
        isHost={isHost}
      />
    </>
  );
}
