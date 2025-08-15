import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSocketConnection } from '../services/SocketProvider';

/**
 * ConnectionStatus component displays connection state to users
 * Shows reconnecting overlay when connection is lost
 */
export default function ConnectionStatus() {
  const isConnected = useSocketConnection();
  const [showReconnecting, setShowReconnecting] = useState(false);
  const [hasBeenConnected, setHasBeenConnected] = useState(false);

  useEffect(() => {
    if (isConnected && !hasBeenConnected) {
      setHasBeenConnected(true);
    }

    // Only show reconnecting if we've been connected before and lost connection
    if (!isConnected && hasBeenConnected) {
      // Small delay to avoid flashing on brief disconnects
      const timer = setTimeout(() => {
        setShowReconnecting(true);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setShowReconnecting(false);
    }
  }, [isConnected, hasBeenConnected]);

  return (
    <AnimatePresence>
      {showReconnecting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] pointer-events-none"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-[#242424] rounded-xl p-6 shadow-2xl border border-[#1db954]/30 pointer-events-auto"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-3 border-[#1db954] border-t-transparent rounded-full animate-spin"></div>
              <h3 className="text-white text-xl font-semibold">Reconnecting...</h3>
              <p className="text-gray-400 text-sm">Please wait while we restore your connection</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}