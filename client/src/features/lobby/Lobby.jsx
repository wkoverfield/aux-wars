import React, { useState, useEffect, useRef } from "react";
// import { useSocket, useSocketConnection } from "../../services/SocketProvider";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import PlayerList from "../../components/PlayerList";
import SettingsModal from "../../components/SettingsModal";
import SessionTakenOverModal from "../../components/SessionTakenOverModal";
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
  // const socket = useSocket();
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
  const [showTakenOverModal, setShowTakenOverModal] = useState(false);
  const allPlayersReady = players.every((player) => player.isReady);
  // const isConnected = useSocketConnection();
  const playersQuery = useQuery(api.game.rooms.getPlayers, routeGameCode ? { code: routeGameCode } : 'skip');
  const roomQuery = useQuery(api.game.rooms.getRoomByCode, routeGameCode ? { code: routeGameCode } : 'skip');
  const updatePlayerName = useMutation(api.game.rooms.updatePlayerName);
  const heartbeat = useMutation(api.game.rooms.heartbeat);
  const leaveGame = useMutation(api.game.rooms.leaveGame);
  const startGame = useMutation(api.game.flow.startGame);
  const hasJoinedGame = useRef(false);

  // Join game only once when component mounts
  useEffect(() => {
    if (!routeGameCode) {
      navigate("/");
      return;
    }
    setGameCode(routeGameCode);
    setName(session?.playerName || "");
  }, [routeGameCode, session]);

  // Set up socket event listeners
  useEffect(() => {
    if (Array.isArray(playersQuery)) {
      setPlayers(playersQuery);
    }
  }, [playersQuery]);

  // Update host status when players change
  useEffect(() => {
    const me = players.find((p) => p.playerId === session?.playerId);
    if (me) setIsHost(me.isHost);
  }, [players, session]);

  // Update player's name and ready status
  useEffect(() => {
    const run = async () => {
      if (!gameCode || !session?.playerId) return;
      const resp = await updatePlayerName({ code: gameCode, playerId: session.playerId, name, isReady });
      // If update failed because player not found (e.g., duplicate ID in another tab), force rejoin flow
      if (resp && resp.code === 'PLAYER_NOT_FOUND') {
        // Clear session so Home will create a fresh playerId on next navigation
        clearSession();
        navigate('/', { replace: true });
        return;
      }
      if (session && name !== session.playerName) updateSession({ playerName: name });
    };
    run();
  }, [name, isReady]);

  // Listen for game settings updates from the server
  useEffect(() => {
    const updatedSettings = roomQuery?.room?.settings || roomQuery?.settings;
    if (updatedSettings) {
      dispatch({ type: "SET_ROUNDS", payload: updatedSettings.numberOfRounds });
      dispatch({ type: "SET_ROUND_LENGTH", payload: updatedSettings.roundLength });
      dispatch({ type: "SET_SELECTED_PROMPTS", payload: updatedSettings.selectedPrompts });
    }
  }, [roomQuery]);

  // Phase and prompt updates are driven by Convex queries via GameRouteGuard

  /**
   * Heartbeat system to detect if connection has been taken over
   * Runs every 5 seconds to check if this tab is still the active connection
   */
  useEffect(() => {
    if (!gameCode || !session?.playerId || !session?.connectionId) return;

    const runHeartbeat = async () => {
      try {
        const result = await heartbeat({
          code: gameCode,
          playerId: session.playerId,
          connectionId: session.connectionId
        });

        if (result.status === 'TAKEN_OVER') {
          // This tab's connection has been replaced by another tab/device
          console.log('[Heartbeat] Connection taken over - showing modal');
          setShowTakenOverModal(true);
        } else if (result.status === 'NOT_FOUND') {
          // Player no longer exists in room
          console.log('[Heartbeat] Player not found - redirecting to home');
          clearSession();
          navigate('/', { replace: true });
        }
      } catch (error) {
        console.error('[Heartbeat] Error:', error);
      }
    };

    // Run immediately on mount
    runHeartbeat();

    // Then run every 5 seconds
    const interval = setInterval(runHeartbeat, 5000);

    return () => clearInterval(interval);
  }, [gameCode, session?.playerId, session?.connectionId, heartbeat, clearSession, navigate]);

  /**
   * Clean disconnection when user closes the browser tab or navigates away
   * This ensures immediate room cleanup if they were the last player
   */
  useEffect(() => {
    if (!gameCode || !session?.playerId) return;

    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable delivery even during page unload
      // This is more reliable than async fetch during beforeunload
      const data = JSON.stringify({
        code: gameCode,
        playerId: session.playerId
      });

      // Note: In production, you might want to call leaveGame via navigator.sendBeacon
      // For now, we rely on the mutation being called synchronously
      leaveGame({ code: gameCode, playerId: session.playerId }).catch(() => {
        // Ignore errors during unload
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [gameCode, session?.playerId, leaveGame]);

  /**
   * Handles leaving the game and returning to home
   */
  const handleLeaveGame = async () => {
    if (!gameCode || !session?.playerId) return;
    await leaveGame({ code: gameCode, playerId: session.playerId });
    clearSession();
    navigate("/lobby", { replace: true });
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
  const handleStartGame = async () => {
    
    if (!isHost) {
      return;
    }

    if (!allPlayersReady) {
      return;
    }

    if (players.length < 3) {
      return;
    }
    if (!session?.playerId) return;
    await startGame({ code: gameCode, playerId: session.playerId });
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
      <SessionTakenOverModal
        show={showTakenOverModal}
        gameCode={gameCode}
      />
    </>
  );
}
