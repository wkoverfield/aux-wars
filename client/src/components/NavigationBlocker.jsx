import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGame } from '../services/GameContext';

/**
 * NavigationBlocker component that prevents accidental navigation during active games
 * Shows a confirmation dialog when users try to leave game pages
 */
export default function NavigationBlocker() {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useGame();
  const { phase } = state;

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