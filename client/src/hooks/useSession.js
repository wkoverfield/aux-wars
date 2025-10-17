import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Custom hook for managing player session data
 * Combines persistent data (localStorage) with per-tab connection tracking
 *
 * Session Model:
 * - playerId: Persistent across refreshes (localStorage)
 * - connectionId: Unique per browser tab/page load (ephemeral)
 * - This allows refresh to work while preventing duplicate tabs
 */
export function useSession() {
  const STORAGE_KEY = 'auxWarsSession';

  // Generate unique connectionId for this tab/page load
  // This is ephemeral - NOT stored, regenerated every page load
  const connectionId = useMemo(() => crypto.randomUUID(), []);

  // Initialize state from localStorage
  const [session, setSession] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsedSession = stored ? JSON.parse(stored) : null;

      // Add connectionId to session
      if (parsedSession) {
        return { ...parsedSession, connectionId };
      }
      return null;
    } catch (error) {
      return null;
    }
  });

  // Save session to localStorage whenever it changes
  useEffect(() => {
    if (session) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } catch (error) {
        // Storage not available - session won't persist
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [session]);

  // Create or update session
  const createSession = useCallback((data) => {
    const newSession = {
      playerId: data.playerId || crypto.randomUUID(),
      connectionId, // Add ephemeral connectionId
      gameCode: data.gameCode,
      playerName: data.playerName || '',
      lastPhase: data.lastPhase || 'lobby',
      timestamp: Date.now()
    };
    setSession(newSession);
    return newSession;
  }, [connectionId]);

  // Update specific session fields
  const updateSession = useCallback((updates) => {
    setSession(prev => prev ? { ...prev, ...updates, connectionId, timestamp: Date.now() } : null);
  }, [connectionId]);

  // Clear session
  const clearSession = useCallback(() => {
    setSession(null);
  }, []);

  // Check if session is valid (not expired - 24 hour expiry)
  const isSessionValid = useCallback(() => {
    if (!session) return false;
    const expiryTime = 24 * 60 * 60 * 1000; // 24 hours
    return Date.now() - session.timestamp < expiryTime;
  }, [session]);

  return {
    session,
    connectionId, // Expose connectionId so callers can use it before session is created
    createSession,
    updateSession,
    clearSession,
    isSessionValid
  };
}