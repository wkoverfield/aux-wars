import { useCallback, useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation, useParams, Outlet } from 'react-router-dom';
// import { useSocket, useSocketConnection } from '../services/SocketProvider';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../hooks/useSession';
import { useLeaveOnClose } from '../features/quickplay/useQuickPlay';
import { useToast } from '../contexts/ToastContext';
import JoinGate from '../features/lobby/JoinGate';
import { useNoIndex } from '../hooks/useNoIndex';
// GameContext removed - using RoomProvider's Convex queries directly

/**
 * GameRouteGuard component that protects game routes and handles rejoining
 * Validates player sessions and game state before allowing access
 */
export default function GameRouteGuard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { gameCode } = useParams();
  // Room URLs are private and short-lived; keep them out of search.
  useNoIndex();
  // const socket = useSocket();
  // const isConnected = useSocketConnection();
  const { session, updateSession } = useSession();
  const { showToast } = useToast();
  const [isValidating, setIsValidating] = useState(true);
  const hasInitialized = useRef(false);
  const toldMissing = useRef(false);
  // A room that is gone sends the visitor home with a reason, once.
  const leaveMissingRoom = useCallback(() => {
    if (!toldMissing.current) {
      toldMissing.current = true;
      showToast(
        hasInitialized.current ? "This game has ended." : "That game doesn't exist anymore. Check the link or ask for a new one.",
        "warning"
      );
    }
    navigate('/', { replace: true });
  }, [navigate, showToast]);
  const roomData = useQuery(api.game.rooms.getRoomByCode, gameCode ? { code: gameCode } : 'skip');

  // Closing the tab gives the seat up a few seconds later unless the page
  // comes back (a reload fires the same pagehide event as a close): on every
  // Quick Play route, and in a private room's lobby.
  const resumeSeat = useMutation(api.game.rooms.resumeSeat);
  const guardedRoom = roomData?.room || roomData;
  useLeaveOnClose({
    resume: resumeSeat,
    enabled:
      Boolean(guardedRoom) &&
      (guardedRoom.isPublic || guardedRoom.phase === 'lobby') &&
      session?.gameCode === gameCode,
    code: gameCode,
    playerId: session?.playerId,
    connectionId: session?.connectionId,
  });

  // Initial validation: stop loading on first data or redirect if missing
  useEffect(() => {
    if (hasInitialized.current) return;
    if (roomData === null) {
      leaveMissingRoom();
      return;
    }
    if (roomData !== undefined) {
      hasInitialized.current = true;
      setIsValidating(false);
    }
  }, [roomData, leaveMissingRoom]);

  // Update session with current phase (for rejoin logic)
  useEffect(() => {
    if (roomData === null) {
      leaveMissingRoom();
      return;
    }
    if (!roomData) return;
    const room = roomData.room || roomData;
    if (room?.phase) updateSession({ lastPhase: room.phase });
  }, [roomData, updateSession, leaveMissingRoom]);

  // Handle phase-based routing (using Convex query data directly)
  useEffect(() => {
    if (isValidating) {
      return;
    }

    if (!roomData) {
      return;
    }

    const room = roomData.room || roomData;
    const phase = room?.phase;

    if (!phase) {
      return;
    }

    const basePath = `/lobby/${gameCode}`;
    let targetPath = basePath;

    switch (phase) {
      case 'lobby':
        targetPath = basePath;
        break;
      case 'promptVoting':
      case 'songSelection':
      case 'roundStart':
        targetPath = `${basePath}/round`;
        break;
      case 'rating':
        targetPath = `${basePath}/round`;
        break;
      case 'results':
        targetPath = `${basePath}/results`;
        break;
      case 'gameOver':
        targetPath = `${basePath}/gamewinner`;
        break;
    }


    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
    // Already on correct path, no action needed
  }, [roomData, isValidating, gameCode, location.pathname, navigate]);

  // Show loading state while validating
  if (isValidating) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-white text-xl">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-[#1db954] border-t-transparent rounded-full animate-spin"></div>
            <p>Connecting to game...</p>
          </div>
        </div>
      </div>
    );
  }

  // Someone who is not in this room (an invite link, or a session for another
  // room) gets the join screen instead of a room they cannot act in.
  if (guardedRoom && session?.gameCode !== gameCode) {
    return <JoinGate code={gameCode} room={guardedRoom} players={roomData?.players || []} />;
  }

  // Render child routes
  return <Outlet />;
}