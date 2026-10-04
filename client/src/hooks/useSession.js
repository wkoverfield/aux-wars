import { useCallback, useSyncExternalStore } from 'react';

/**
 * Player session state, shared across every component that calls useSession().
 *
 * Session Model:
 * - playerId: Persistent across refreshes (localStorage)
 * - connectionId: Unique per browser tab/page load (sessionStorage)
 * - This allows refresh to work while preventing duplicate tabs
 *
 * The session lives in ONE module-level store (not per-hook React state).
 * Every useSession() instance reads the same snapshot via useSyncExternalStore
 * and writes through the same setter, so clearing the session in one component
 * cannot be raced by another component writing its own stale copy back to
 * localStorage (the old per-instance-state design did exactly that after a
 * kick: GameRouteGuard's updateSession resurrected the session Lobby had just
 * cleared).
 */

const STORAGE_KEY = 'auxWarsSession';
const CONNECTION_KEY = 'aux-wars-connection-id';

// One connectionId per browser tab: persists across navigation within the tab
// (sessionStorage) but is unique per tab, which prevents duplicate-tab issues.
let connectionId = null;
function getConnectionId() {
  if (connectionId) return connectionId;
  try {
    let id = sessionStorage.getItem(CONNECTION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(CONNECTION_KEY, id);
    }
    connectionId = id;
  } catch {
    connectionId = crypto.randomUUID();
  }
  return connectionId;
}

function loadStoredSession() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    return parsed ? { ...parsed, connectionId: getConnectionId() } : null;
  } catch {
    return null;
  }
}

let currentSession = loadStoredSession();
const listeners = new Set();

function setSession(next) {
  currentSession = next;
  // Write-through persistence: the store is the only writer of the storage
  // key. connectionId is tab-specific and lives in sessionStorage, never here.
  try {
    if (next) {
      const { connectionId: omitted, ...toStore } = next; void omitted;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage not available - session won't persist
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentSession;
}

// Create or update session
function createSession(data) {
  const newSession = {
    playerId: data.playerId || crypto.randomUUID(),
    connectionId: getConnectionId(),
    gameCode: data.gameCode,
    playerName: data.playerName || '',
    lastPhase: data.lastPhase || 'lobby',
    // Quick Play seats: the secret that proves ownership of the seat on
    // rejoin (the server stores only its hash).
    ...(data.seatKey ? { seatKey: data.seatKey, quickPlay: true } : {}),
    timestamp: Date.now(),
  };
  setSession(newSession);
  return newSession;
}

// Update specific session fields. A cleared (null) session stays cleared:
// updates never resurrect it.
function updateSession(updates) {
  if (!currentSession) return;
  setSession({
    ...currentSession,
    ...updates,
    connectionId: getConnectionId(),
    timestamp: Date.now(),
  });
}

// Clear session
function clearSession() {
  setSession(null);
}

// Test-only: reset the module store between tests.
export function _resetSessionStoreForTests() {
  connectionId = null;
  currentSession = loadStoredSession();
  listeners.forEach((listener) => listener());
}

export function useSession() {
  const session = useSyncExternalStore(subscribe, getSnapshot);

  // Check if session is valid (not expired - 24 hour expiry)
  const isSessionValid = useCallback(() => {
    if (!session) return false;
    const expiryTime = 24 * 60 * 60 * 1000; // 24 hours
    return Date.now() - session.timestamp < expiryTime;
  }, [session]);

  return {
    session,
    connectionId: getConnectionId(), // usable before a session is created
    createSession,
    updateSession,
    clearSession,
    isSessionValid,
  };
}
