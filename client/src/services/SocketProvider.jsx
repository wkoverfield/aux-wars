import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';

/**
 * SocketContext provides socket.io connection management for the application.
 * Handles connection state, reconnection logic, and game phase transitions.
 */
const SocketContext = createContext(null);

// Get the server URL from environment variables or use a default
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Track if we're currently transitioning between game phases
let isInGameTransition = false;

/**
 * SocketProvider component that manages socket.io connection and provides socket context
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 * @returns {JSX.Element} Provider component
 */
export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const ignoreDisconnectsUntil = useRef(0);

  /**
   * Marks that we're in a game transition and temporarily ignores disconnects
   * @param {boolean} inTransition - Whether we're in a transition
   */
  const setGameTransition = (inTransition) => {
    isInGameTransition = inTransition;
    if (inTransition) {
      // Ignore disconnects for the next 5 seconds during transitions
      ignoreDisconnectsUntil.current = Date.now() + 5000;
    }
  };

  useEffect(() => {
    
    // Create new socket instance
    const newSocket = io(SERVER_URL, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
      transports: ['polling', 'websocket'],
      withCredentials: true, // Important for CORS
      path: '/socket.io/',
      reconnection: true,
      reconnectionDelayMax: 5000
    });
    

    // Set up socket event listeners
    newSocket.on('connect', () => {
      setIsConnected(true);
    });
    
    newSocket.on('connecting', () => {
      // Connection in progress
    });

    newSocket.on('connect_error', (error) => {
      setIsConnected(false);
      console.error('Connection failed:', error.message);
    });
    
    newSocket.on('connect_timeout', () => {
      setIsConnected(false);
    });

    newSocket.on('disconnect', (reason) => {
        setIsConnected(false);
        
        // Don't redirect during game phase transitions
        if (isInGameTransition || Date.now() < ignoreDisconnectsUntil.current) {
          return;
        }
        
        // Only redirect on unexpected disconnects and if we're not in a game
        if ((reason === 'io server disconnect' || reason === 'transport close') 
            && !window.location.pathname.includes('/lobby/')) {
          navigate('/lobby', { replace: true });
        }
      });

    newSocket.on('reconnect', () => {
      setIsConnected(true);
    });
    
    newSocket.on('reconnect_attempt', () => {
      // Attempting to reconnect
    });

    newSocket.on('reconnect_error', () => {
      setIsConnected(false);
    });

    newSocket.on('reconnect_failed', () => {
      setIsConnected(false);
    });
    
    // Listen for game phase transitions
    newSocket.on('game-phase-updated', () => {
        setGameTransition(true);
        // Reset transition flag after a delay
        setTimeout(() => {
          setGameTransition(false);
        }, 3000);
      });
      
    // Listen for game errors
    newSocket.on('game-error', ({ message }) => {
      showToast(message, 'error');
    });

    setSocket(newSocket);

    // Cleanup on unmount
    return () => {
      newSocket.removeAllListeners();
      newSocket.disconnect();
    };
  }, []); // Remove navigate dependency to avoid reconnects on navigation

  const value = {
    socket,
    isConnected,
    setGameTransition
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

/**
 * Custom hook to access the socket instance
 * @returns {Object} Socket.io instance
 * @throws {Error} If used outside of SocketProvider
 */
export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context.socket;
}

/**
 * Custom hook to access the socket connection state
 * @returns {boolean} Whether the socket is connected
 * @throws {Error} If used outside of SocketProvider
 */
export function useSocketConnection() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocketConnection must be used within a SocketProvider');
  }
  return context.isConnected;
}

/**
 * Custom hook to access the game transition state setter
 * @returns {Function} Function to set game transition state
 * @throws {Error} If used outside of SocketProvider
 */
export function useGameTransition() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useGameTransition must be used within a SocketProvider');
  }
  return context.setGameTransition;
}
