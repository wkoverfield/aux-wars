import { useEffect } from 'react';
import { useMutation } from 'convex/react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../convex/_generated/api';

/**
 * Heartbeat hook to keep player connection alive
 * Sends heartbeat every 5 seconds to prevent timeout
 *
 * @param {string} code - Game room code
 * @param {string} playerId - Player ID
 * @param {string} connectionId - Connection ID for this tab
 * @param {Function} onTakenOver - Callback when connection is taken over
 * @param {Function} clearSession - Function to clear session on disconnect
 */
export function useHeartbeat(code, playerId, connectionId, onTakenOver, clearSession) {
  const heartbeat = useMutation(api.game.rooms.heartbeat);
  const navigate = useNavigate();

  useEffect(() => {
    if (!code || !playerId || !connectionId) return;

    const runHeartbeat = async () => {
      try {
        const result = await heartbeat({
          code,
          playerId,
          connectionId
        });

        if (result.status === 'TAKEN_OVER') {
          // This tab's connection has been replaced by another tab/device
          console.log('[Heartbeat] Connection taken over');
          if (onTakenOver) {
            onTakenOver();
          }
        } else if (result.status === 'NOT_FOUND') {
          // Player no longer exists in room
          console.log('[Heartbeat] Player not found - redirecting to home');
          if (clearSession) {
            clearSession();
          }
          navigate('/', { replace: true });
        }
      } catch (error) {
        console.error('[Heartbeat] Error:', error);
      }
    };

    // Delay initial heartbeat by 1 second to reduce initial load time
    const initialTimeout = setTimeout(runHeartbeat, 1000);

    // Then run every 5 seconds
    const interval = setInterval(runHeartbeat, 5000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [code, playerId, connectionId, heartbeat, onTakenOver, clearSession, navigate]);
}
