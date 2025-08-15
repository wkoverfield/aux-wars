import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation, useParams, Outlet } from 'react-router-dom';
import { useSocket, useSocketConnection } from '../services/SocketProvider';
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
  const socket = useSocket();
  const isConnected = useSocketConnection();
  const { session, updateSession, isSessionValid } = useSession();
  const { state, dispatch } = useGame();
  const [isValidating, setIsValidating] = useState(true);
  const hasInitialized = useRef(false);

  // Initial validation on mount
  useEffect(() => {
    if (hasInitialized.current) {
      return;
    }

    if (!socket || !isConnected) {
      return;
    }
    
    // If already in game, no need to validate
    if (state.players?.some(p => p.id === socket.id)) {
      hasInitialized.current = true;
      setIsValidating(false);
      return;
    }

    const validateSession = async () => {
      
      // Check for valid session and attempt rejoin
      if (session && session.gameCode === gameCode && isSessionValid()) {
        socket.emit('rejoin-game', {
          gameCode,
          playerId: session.playerId,
          playerName: session.playerName
        }, (response) => {
          if (response.success) {
            // Update game state with response data
            dispatch({ type: 'SET_PLAYERS', payload: response.players });
            dispatch({ type: 'SET_PHASE', payload: response.phase });
            dispatch({ type: 'SET_CURRENT_ROUND', payload: response.currentRound });
            if (response.settings) {
              dispatch({ type: 'SET_ROUNDS', payload: response.settings.numberOfRounds });
              dispatch({ type: 'SET_ROUND_LENGTH', payload: response.settings.roundLength });
              dispatch({ type: 'SET_SELECTED_PROMPTS', payload: response.settings.selectedPrompts });
            }
            updateSession({ lastPhase: response.phase });
          } else {
            // Invalid session - will redirect to lobby
          }
          setIsValidating(false);
        });
      } else {
        // No valid session, check if already in game
        if (state.players?.some(p => p.id === socket.id)) {
          setIsValidating(false);
        } else if (location.pathname === `/lobby/${gameCode}`) {
          // We're already in the lobby, let the Lobby component handle joining
          setIsValidating(false);
        } else {
          // Need to join from lobby
          navigate(`/lobby/${gameCode}`, { replace: true });
        }
      }
    };

    hasInitialized.current = true;
    validateSession();
  }, [socket, isConnected, gameCode, session, isSessionValid, state.players, dispatch, updateSession, navigate]);

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
        targetPath = `${basePath}/rate`;
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