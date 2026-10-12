import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { usePendingAction } from "../../hooks/usePendingAction";
import { copyInvite, inviteUrl, sendInvite } from "./invite";
import InviteQrModal from "./InviteQrModal";
import { useSession } from "../../hooks/useSession";
import { useHeartbeat } from "../../hooks/useHeartbeat";
import { useToast } from "../../contexts/ToastContext";
import { getPackIdsForPrompts } from "../../data/promptCategories";
import { captureGameEvent, gameProperties } from "../../services/analytics";
import logo from "../../assets/aux-wars-logo.svg";
import ScrollFade from "../../components/ScrollFade";
import { useRoom } from "../../services/RoomProvider";
import PublicLobby from "../quickplay/PublicLobby";
import NameInput from "./NameInput";

/**
 * Lobby route: Quick Play rooms get the hostless waiting screen, private rooms
 * the hosted lobby.
 */
export default function Lobby() {
  const { room, loading } = useRoom();
  if (loading) return null;
  return room?.isPublic ? <PublicLobby /> : <PrivateLobby />;
}

/**
 * Private (hosted) lobby: players join with the code, set their names and
 * ready up; the host manages settings, kicks and starts the game.
 *
 * @returns {JSX.Element} Rendered component
 */
function PrivateLobby() {
  // const socket = useSocket();
  const navigate = useNavigate();
  const { gameCode: routeGameCode } = useParams();
  const { session, updateSession, clearSession } = useSession();
  const { showToast } = useToast();
  const [gameCode, setGameCode] = useState(routeGameCode || "");
  // Latest nickname draft from NameInput, kept in a ref so typing does not
  // re-render the whole lobby.
  const nameDraftRef = useRef(session?.playerName || "");
  const handleDraftChange = useCallback((draft) => { nameDraftRef.current = draft; }, []);
  // Optimistic Ready value from a tap, shown until the server row matches.
  const [readyOverride, setReadyOverride] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showTakenOverModal, setShowTakenOverModal] = useState(false);
  // const isConnected = useSocketConnection();
  const playersQuery = useQuery(api.game.rooms.getPlayers, routeGameCode ? { code: routeGameCode } : 'skip');
  const roomQuery = useQuery(api.game.rooms.getRoomByCode, routeGameCode ? { code: routeGameCode} : 'skip');

  // Derive from queries - no local state duplication
  const players = useMemo(() => playersQuery || [], [playersQuery]);
  const room = roomQuery?.room || roomQuery;
  const me = players.find(p => p.playerId === session?.playerId);
  const isHost = me?.isHost ?? false;
  const serverReady = me?.isReady ?? false;
  const isReady = readyOverride ?? serverReady;
  const allPlayersReady = players.every((player) => player.isReady);
  const updatePlayerName = useMutation(api.game.rooms.updatePlayerName);
  const leaveGame = useMutation(api.game.rooms.leaveGame);
  const kickPlayer = useMutation(api.game.rooms.kickPlayer);
  const startGame = useMutation(api.game.flow.startGame);
  const startAction = usePendingAction();
  // Once the game has started the route guard moves on a render later; keep
  // the button reading "Starting..." until then instead of flashing back.
  const launching = startAction.pending || Boolean(room?.phase && room.phase !== "lobby");
  const logPromptPacksUsed = useMutation(api.analytics.logPromptPacksUsed);

  // Streamer-safe display state: lock indicator + hide-code. Both toggles live in
  // the Settings modal (niche/host-only) — this just reflects their state.
  const locked = !!room?.locked;
  const [streamerHide, setStreamerHide] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const logEvent = useMutation(api.analytics.logEvent);
  const noteInvite = (method) => {
    logEvent({ eventType: "invite_shared", metadata: { reason: method } }).catch(() => {});
    captureGameEvent("invite_shared", gameProperties({ code: gameCode, room, players, session, extra: { method } }));
  };
  /** Share sheet where the device has one, otherwise the clipboard. */
  const handleInvite = async () => {
    const outcome = await sendInvite(inviteUrl(gameCode));
    if (outcome === "shared") noteInvite("share");
    else if (outcome === "copied") {
      noteInvite("copy");
      showToast("Invite link copied", "success");
    } else if (outcome === "failed") {
      showToast("Couldn't copy the link. Grab the URL from the address bar.", "warning");
    }
  };
  /** Tapping the room code copies just the code, to paste into a chat. */
  const handleCopyCode = async () => {
    if (await copyInvite(gameCode)) {
      noteInvite("code");
      showToast("Code copied", "success");
    } else {
      showToast("Couldn't copy the code.", "warning");
    }
  };
  const handleShowQr = () => {
    setShowQr(true);
    noteInvite("qr");
  };

  // Initialize game code once on mount
  useEffect(() => {
    if (!routeGameCode) {
      navigate("/");
      return;
    }
    setGameCode(routeGameCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeGameCode]);

  // Drop the optimistic Ready value once the server row agrees with it.
  useEffect(() => {
    if (readyOverride !== null && me && me.isReady === readyOverride) {
      setReadyOverride(null);
    }
  }, [readyOverride, me]);

  /**
   * Handles a non-OK updatePlayerName response. Returns true when handled.
   */
  const handleUpdateResponse = useCallback((resp) => {
    // Player not found (e.g. duplicate ID in another tab): force the rejoin flow.
    if (resp?.code === 'PLAYER_NOT_FOUND') {
      clearSession();
      navigate('/', { replace: true });
      return true;
    }
    if (resp?.code === 'CONNECTION_TAKEN_OVER') {
      setShowTakenOverModal(true);
      return true;
    }
    if (resp?.code === 'INVALID_NAME') {
      showToast(resp.message || "Please choose a different name", "warning");
      return true;
    }
    return false;
  }, [clearSession, navigate, showToast]);

  /**
   * Saves a changed nickname. Never sends isReady, so a name save cannot
   * overwrite a Ready tap.
   */
  const handleSaveName = useCallback(async (trimmedName) => {
    if (!gameCode || !session?.playerId || !session?.connectionId) return;
    try {
      const resp = await updatePlayerName({
        code: gameCode,
        playerId: session.playerId,
        connectionId: session.connectionId,
        name: trimmedName,
      });
      if (handleUpdateResponse(resp)) return;
      updateSession({ playerName: trimmedName });
    } catch {
      showToast("Couldn't save your nickname. Please try again.", "error");
    }
  }, [gameCode, session?.playerId, session?.connectionId, updatePlayerName, handleUpdateResponse, updateSession, showToast]);

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
  const handleKickPlayer = useCallback(async (targetPlayerId) => {
    if (!isHost || !session?.playerId || !session?.connectionId || !gameCode) return;

    const result = await kickPlayer({
      code: gameCode,
      hostPlayerId: session.playerId,
      hostConnectionId: session.connectionId,
      targetPlayerId
    });

    if (result.success) {
      showToast("Player removed from lobby", "success");
    } else {
      showToast(result.message || "Failed to kick player", "error");
    }
  }, [isHost, session?.playerId, session?.connectionId, gameCode, kickPlayer, showToast]);

  /**
   * Toggles Ready: shown immediately, sent at once as an isReady-only write,
   * and reverted if the server refuses it.
   */
  const handleReady = async () => {
    if (!nameDraftRef.current.trim() && !me?.name?.trim()) {
      showToast("Please set your nickname before readying up.", "warning");
      return;
    }
    if (!gameCode || !session?.playerId || !session?.connectionId) return;
    const nextReady = !isReady;
    setReadyOverride(nextReady);
    try {
      const resp = await updatePlayerName({
        code: gameCode,
        playerId: session.playerId,
        connectionId: session.connectionId,
        isReady: nextReady,
      });
      if (resp?.code && resp.code !== 'OK') {
        setReadyOverride(null);
        handleUpdateResponse(resp);
      }
    } catch {
      setReadyOverride(null);
      showToast("Couldn't update your ready status. Please try again.", "error");
    }
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
    let sent = false;
    try {
      await startAction.run(() => {
        sent = true;
        return startGame({ code: gameCode, playerId: session.playerId, connectionId: session.connectionId });
      });
    } catch {
      showToast("Couldn't start the game. Please try again.", "error");
      return;
    }
    if (!sent) return; // a start was already in flight
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
        data-vital="lobby"
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
              <NameInput
                serverName={me?.name}
                initialName={session?.playerName || ""}
                onSave={handleSaveName}
                onDraftChange={handleDraftChange}
              />
              <div className="lobby-code-count flex gap-5">
                <div className="lobby-container rounded-md lobby-code flex flex-col gap-2">
                  <p className="text-xs font-normal">Code{locked ? ' · 🔒' : ''}</p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-vital="invite"
                      onClick={handleCopyCode}
                      aria-label="Copy room code"
                      title="Copy room code"
                      className="text-2xl text-left cursor-pointer hover:text-[#68d570] transition-colors mr-1"
                    >
                      {streamerHide ? '••••••' : gameCode}
                    </button>
                    {/* Share sheet on a phone; copies the full invite link elsewhere. */}
                    <button
                      type="button"
                      data-vital="invite"
                      onClick={handleInvite}
                      aria-label="Share invite link"
                      title="Share invite link"
                      className="p-1.5 rounded text-gray-400 hover:text-white transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15" />
                      </svg>
                    </button>
                    {/* A QR code on screen would show the room to a stream. */}
                    {!streamerHide && (
                      <button
                        type="button"
                        data-vital="invite-qr"
                        onClick={handleShowQr}
                        aria-label="Show QR code"
                        title="Show QR code"
                        className="p-1.5 rounded text-gray-400 hover:text-white transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="lobby-container rounded-md lobby-count flex flex-col gap-2">
                  <p className="text-xs font-normal">{room?.settings?.hostPro ? 'Players · Pro' : 'Players'}</p>
                  <p className="text-2xl">{players.length}/{room?.settings?.hostPro ? 50 : 8}</p>
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
                    data-vital="ready"
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
                onEdit={() => setShowModal(true)}
              />
            </div>
            <ScrollFade className="flex-1 w-full min-h-0">
              <PlayerList
                players={players}
                isHost={isHost}
                currentPlayerId={session?.playerId}
                onKick={handleKickPlayer}
              />
              {/* An empty seat, quiet on purpose: it reads as part of the list. */}
              {players.length === 1 && (
                <button
                  type="button"
                  data-vital="invite"
                  onClick={handleInvite}
                  className="mt-4 w-full rounded-md border border-dashed border-gray-600 px-4 py-3 text-left text-sm text-gray-400 hover:border-gray-400 hover:text-white transition-colors"
                >
                  Invite a friend to get started
                </button>
              )}
              {/* Ad-safe: lobby is a waiting surface; scrolls with the list, ad-free in pro rooms */}
              <AdSlot slot="lobby" />
            </ScrollFade>
          </div>
          {isHost && allPlayersReady && players.length > 1 && (
            <button
              className="green-btn fixed bottom-0 w-full text-black py-3 text-center"
              data-vital="start"
              onClick={handleStartGame}
              disabled={launching}
              aria-busy={launching}
            >
              {launching ? "Starting..." : "Start Game"}
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
        streamerHide={streamerHide}
        onToggleStreamerHide={() => setStreamerHide((v) => !v)}
      />
      {showQr && <InviteQrModal url={inviteUrl(gameCode)} onClose={() => setShowQr(false)} />}
      <SessionTakenOverModal
        show={showTakenOverModal}
        gameCode={gameCode}
      />
    </>
  );
}
