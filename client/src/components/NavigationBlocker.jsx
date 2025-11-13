import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

/**
 * NavigationBlocker component that prevents accidental navigation during active games
 * Shows a confirmation dialog when users try to leave game pages
 */
export default function NavigationBlocker() {
  const location = useLocation();
  const navigate = useNavigate();

  // Extract gameCode from URL path
  const gameCodeMatch = location.pathname.match(/\/lobby\/([^/]+)/);
  const gameCode = gameCodeMatch ? gameCodeMatch[1] : null;

  // Query room data to get current phase
  const roomQuery = useQuery(api.game.rooms.getRoomByCode, gameCode ? { code: gameCode } : 'skip');
  const room = roomQuery?.room || roomQuery;
  const phase = room?.phase || '';

  useEffect(() => {
    // Only block navigation if we're in an active game (not in lobby)
    const isInActiveGame = location.pathname.includes('/lobby/') && 
                          phase !== 'lobby' && 
                          phase !== '';

    if (!isInActiveGame) return;

    // Handle browser back/forward navigation
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'Are you sure you want to leave? You will lose your progress in the current game.';
      return e.returnValue;
    };

    // Add event listener
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [location, phase]);

  return null;
}