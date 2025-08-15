import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for managing player session data in localStorage
 * Provides persistent session management across page refreshes
 */
export function useSession() {
  const STORAGE_KEY = 'auxWarsSession';
  
  // Initialize state from localStorage
  const [session, setSession] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
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
      gameCode: data.gameCode,
      playerName: data.playerName || '',
      lastPhase: data.lastPhase || 'lobby',
      timestamp: Date.now()
    };
    setSession(newSession);
    return newSession;
  }, []);

  // Update specific session fields
  const updateSession = useCallback((updates) => {
    setSession(prev => prev ? { ...prev, ...updates, timestamp: Date.now() } : null);
  }, []);

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
    createSession,
    updateSession,
    clearSession,
    isSessionValid
  };
}