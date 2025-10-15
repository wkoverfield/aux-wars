import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation, useParams, Outlet } from 'react-router-dom';
// import { useSocket, useSocketConnection } from '../services/SocketProvider';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useSession } from '../hooks/useSession';
import { useGame } from '../services/GameContext';

/**
 * GameRouteGuard component that protects game routes and handles rejoining
 * Validates player sessions and game state before allowing access
 */
export default function GameRouteGuard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { gameCode } = useParams();
  // const socket = useSocket();
  // const isConnected = useSocketConnection();
  const { session, updateSession, isSessionValid } = useSession();
  const { state, dispatch } = useGame();
  const [isValidating, setIsValidating] = useState(true);
  const hasInitialized = useRef(false);
  const roomData = useQuery(api.game.rooms.getRoomByCode, gameCode ? { code: gameCode } : 'skip');

  // Initial validation: stop loading on first data or redirect if missing
  useEffect(() => {
    if (hasInitialized.current) return;
    if (roomData === null) {
      navigate('/', { replace: true });
      return;
    }
    if (roomData !== undefined) {
      hasInitialized.current = true;
      setIsValidating(false);
    }
  }, [roomData, navigate]);

  // Always sync state from room data so routing can react to changes
  useEffect(() => {
    if (roomData === null) {
      navigate('/', { replace: true });
      return;
    }
    if (!roomData) return;
    const room = roomData.room || roomData;
    const players = roomData.players || [];
    if (room?.settings) {
      dispatch({ type: 'SET_ROUNDS', payload: room.settings.numberOfRounds });
      dispatch({ type: 'SET_ROUND_LENGTH', payload: room.settings.roundLength });
      dispatch({ type: 'SET_SELECTED_PROMPTS', payload: room.settings.selectedPrompts });
    }
    dispatch({ type: 'SET_PROMPT', payload: room?.currentPrompt || '' });
    dispatch({ type: 'SET_PLAYERS', payload: players });
    dispatch({ type: 'SET_PHASE', payload: room?.phase });
    dispatch({ type: 'SET_CURRENT_ROUND', payload: room?.currentRound || 1 });
    if (room?.phase) updateSession({ lastPhase: room.phase });
  }, [roomData, dispatch, updateSession, navigate]);

  // Handle phase-based routing
  useEffect(() => {
    if (isValidating) {
      return;
    }
    
    if (!state.phase) {
      return;
    }

    const basePath = `/lobby/${gameCode}`;
    let targetPath = basePath;

    switch (state.phase) {
      case 'lobby':
        targetPath = basePath;
        break;
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
  }, [state.phase, isValidating, gameCode, location.pathname, navigate]);

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

  // Render child routes
  return <Outlet />;
}