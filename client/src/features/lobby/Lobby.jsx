import React, { useState, useEffect, useRef } from "react";
// import { useSocket, useSocketConnection } from "../../services/SocketProvider";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import PlayerList from "../../components/PlayerList";
import SettingsModal from "../../components/SettingsModal";
import SettingsPreview from "../../components/SettingsPreview";
import AdSlot from "../../components/AdSlot";
import SessionTakenOverModal from "../../components/SessionTakenOverModal";
// GameContext removed - using RoomProvider's Convex queries directly
import { useSession } from "../../hooks/useSession";
import { useHeartbeat } from "../../hooks/useHeartbeat";
import { useToast } from "../../contexts/ToastContext";
import { getPackIdsForPrompts } from "../../data/promptCategories";
import { captureGameEvent, gameProperties } from "../../services/analytics";
import logo from "../../assets/aux-wars-logo.svg";
import ScrollFade from "../../components/ScrollFade";

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
  const { session, createSession, updateSession, clearSession } = useSession();
  const { showToast } = useToast();
  const [gameCode, setGameCode] = useState(routeGameCode || "");
  const [name, setName] = useState(session?.playerName || "");
  const [isReady, setIsReady] = useState(false);
  const [animateInput, setAnimateInput] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showTakenOverModal, setShowTakenOverModal] = useState(false);
  // const isConnected = useSocketConnection();
  const playersQuery = useQuery(api.game.rooms.getPlayers, routeGameCode ? { code: routeGameCode } : 'skip');
  const roomQuery = useQuery(api.game.rooms.getRoomByCode, routeGameCode ? { code: routeGameCode} : 'skip');

  // Derive from queries - no local state duplication
  const players = playersQuery || [];
  const room = roomQuery?.room || roomQuery;
  const isHost = players.find(p => p.playerId === session?.playerId)?.isHost ?? false;
  const allPlayersReady = players.every((player) => player.isReady);
  const updatePlayerName = useMutation(api.game.rooms.updatePlayerName);
  const leaveGame = useMutation(api.game.rooms.leaveGame);
  const kickPlayer = useMutation(api.game.rooms.kickPlayer);
  const startGame = useMutation(api.game.flow.startGame);
  const logPromptPacksUsed = useMutation(api.analytics.logPromptPacksUsed);
  const setRoomLock = useMutation(api.game.rooms.setRoomLock);
  const hasJoinedGame = useRef(false);

  // Streamer-safe controls: lock the room (block new joins) + hide the code on screen.
  const locked = !!room?.locked;
  const [streamerHide, setStreamerHide] = useState(false);
  const handleToggleLock = async () => {
    if (!session?.playerId || !session?.connectionId) return;
    await setRoomLock({ code: gameCode, playerId: session.playerId, connectionId: session.connectionId, locked: !locked });
  };
  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Invite link copied", "success");
    } catch {
      showToast("Couldn't copy — grab the URL from the address bar", "warning");
    }
  };

  // Initialize game code and name once on mount
  useEffect(() => {
    if (!routeGameCode) {
      navigate("/");
      return;
    }
    setGameCode(routeGameCode);
    setName(session?.playerName || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeGameCode]); // Only depend on routeGameCode, not session - prevents resetting name while typing

  // Update player's name and ready status (debounced to prevent glitchy typing)
  const updateNameTimeoutRef = useRef(null);

  useEffect(() => {
    // Clear existing timeout
    if (updateNameTimeoutRef.current) {
      clearTimeout(updateNameTimeoutRef.current);
    }

    // Only schedule update if we have required data
    if (!gameCode || !session?.playerId || !session?.connectionId) return;

    // Debounce: wait 500ms after user stops typing before calling mutation
    updateNameTimeoutRef.current = setTimeout(async () => {
      const resp = await updatePlayerName({
        code: gameCode,
        playerId: session.playerId,
        connectionId: session.connectionId,
        name,
        isReady
      });

      // If update failed because player not found (e.g., duplicate ID in another tab), force rejoin flow
      if (resp && resp.code === 'PLAYER_NOT_FOUND') {
        // Clear session so Home will create a fresh playerId on next navigation
        clearSession();
        navigate('/', { replace: true });
        return;
      }
      // If connection was taken over, show takeover modal
      if (resp && resp.code === 'CONNECTION_TAKEN_OVER') {
        setShowTakenOverModal(true);
        return;
      }
      if (session && name !== session.playerName) updateSession({ playerName: name });
    }, 500); // 500ms delay - smooth typing experience

    // Cleanup timeout on unmount or when dependencies change
    return () => {
      if (updateNameTimeoutRef.current) {
        clearTimeout(updateNameTimeoutRef.current);
      }
    };
  }, [name, isReady, gameCode, session?.playerId, session?.connectionId, updatePlayerName, clearSession, navigate, updateSession]);

  // Settings updates are handled automatically via Convex reactive queries (roomQuery)
  // No need to manually sync - components can read directly from roomQuery.room.settings

  /**
   * Heartbeat system to detect if connection has been taken over
   * Runs every 5 seconds to check if this tab is still the active connection
   */
  useHeartbeat(
    gameCode,
    session?.playerId,
    session?.connectionId,
    () => setShowTakenOverModal(true),
    clearSession
  );

  /**
   * Clean disconnection when user closes the browser tab or navigates away
   * This ensures immediate room cleanup if they were the last player
   */
  useEffect(() => {
    if (!gameCode || !session?.playerId || !session?.connectionId) return;

    const handleBeforeUnload = () => {
      // Note: In production, you might want to call leaveGame via navigator.sendBeacon
      // For now, we rely on the mutation being called synchronously
      leaveGame({ code: gameCode, playerId: session.playerId, connectionId: session.connectionId }).catch(() => {
        // Ignore errors during unload
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [gameCode, session?.playerId, session?.connectionId, leaveGame]);

  /**
   * Verify player still exists in room on mount/refresh
   * Catches expired sessions BEFORE user tries to interact
   */
  useEffect(() => {
    // Wait for players query to load and session to exist
    if (!session?.playerId || players.length === 0) return;

    const playerExists = players.some(p => p.playerId === session.playerId);
    if (!playerExists) {
      showToast("Your session has expired. Please rejoin the lobby.", "warning");
      clearSession();
      navigate("/", { replace: true });
    }
  }, [players, session?.playerId, clearSession, navigate, showToast]);

  /**
   * Handles leaving the game and returning to home
   */
  const handleLeaveGame = async () => {
    if (!gameCode || !session?.playerId || !session?.connectionId) return;

    await leaveGame({ code: gameCode, playerId: session.playerId, connectionId: session.connectionId });
    captureGameEvent("lobby_left", gameProperties({ code: gameCode, room, players, session }));
    clearSession();
    navigate("/lobby", { replace: true });
  };

  /**
   * Handles kicking a player from the lobby (host only)
   */
  const handleKickPlayer = async (targetPlayerId) => {
    if (!isHost || !session?.playerId || !session?.connectionId || !gameCode) return;

    const result = await kickPlayer({
      code: gameCode,
      hostPlayerId: session.playerId,
      hostConnectionId: session.connectionId,
      targetPlayerId
    });

    if (result.success) {
      captureGameEvent("player_kicked", gameProperties({ code: gameCode, room, players, session }));
      showToast("Player removed from lobby", "success");
    } else {
      showToast(result.message || "Failed to kick player", "error");
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
    const nextReady = !isReady;
    setIsReady(nextReady);
    captureGameEvent("player_ready_toggled", gameProperties({
      code: gameCode,
      room,
      players,
      session,
      extra: { ready: nextReady },
    }));
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

    if (players.length < 2) {
      return;
    }
    if (!session?.playerId || !session?.connectionId) return;
    const result = await startGame({ code: gameCode, playerId: session.playerId, connectionId: session.connectionId });
    if (result?.success === false) return;
    captureGameEvent("game_started", gameProperties({ code: gameCode, room, players, session }));

    // Track which prompt packs were used (fire-and-forget; never block game start)
    const packIds = getPackIdsForPrompts(room?.settings?.selectedPrompts || []);
    if (packIds.length > 0) {
      logPromptPacksUsed({ packIds }).catch(() => {});
    }
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
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-normal">Code{locked ? ' · 🔒' : ''}</p>
                    {isHost && (
                      <button
                        type="button"
                        onClick={() => setStreamerHide((v) => !v)}
                        className="text-[11px] text-gray-400 hover:text-white transition"
                        aria-label={streamerHide ? 'Show code' : 'Hide code for streaming'}
                      >
                        {streamerHide ? '👁 Show' : '🙈 Hide'}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl select-none">{streamerHide ? '••••••' : gameCode}</p>
                    <button
                      type="button"
                      onClick={handleCopyInvite}
                      className="text-[11px] text-gray-400 hover:text-white border border-gray-600 rounded px-2 py-1 transition"
                    >
                      Copy link
                    </button>
                  </div>
                </div>
                <div className="lobby-container rounded-md lobby-count flex flex-col gap-2">
                  <p className="text-xs font-normal">{room?.settings?.hostPro ? 'Players · Pro' : 'Players'}</p>
                  <p className="text-2xl">{players.length}/{room?.settings?.hostPro ? 50 : 8}</p>
                </div>
              </div>
              {isHost && (
                <button
                  type="button"
                  onClick={handleToggleLock}
                  className={`rounded-full py-2 px-6 text-sm font-semibold w-full max-w-md transition ${locked ? 'bg-[#68d570] text-black' : 'bg-[#242424] text-white hover:bg-[#2d2d2d]'}`}
                >
                  {locked ? '🔒 Room locked — tap to open' : '🔓 Lock room (block new joins)'}
                </button>
              )}
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
              <p className="text-2xl">Players</p>
              <SettingsPreview
                settings={room?.settings}
                isHost={isHost}
                onEdit={() => {
                  captureGameEvent("settings_opened", gameProperties({ code: gameCode, room, players, session }));
                  setShowModal(true);
                }}
              />
            </div>
            <ScrollFade className="flex-1 w-full min-h-0">
              <PlayerList
                players={players}
                isHost={isHost}
                currentPlayerId={session?.playerId}
                onKick={handleKickPlayer}
              />
              {/* Ad-safe: lobby is a waiting surface; scrolls with the list, ad-free in pro rooms */}
              <AdSlot slot="lobby" />
            </ScrollFade>
          </div>
          {isHost && allPlayersReady && players.length > 1 && (
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
        playerId={session?.playerId}
        connectionId={session?.connectionId}
      />
      <SessionTakenOverModal
        show={showTakenOverModal}
        gameCode={gameCode}
      />
    </>
  );
}
