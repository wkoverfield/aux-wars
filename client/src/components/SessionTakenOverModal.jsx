import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * SessionTakenOverModal - Displayed when user's session has been taken over
 * by another tab or device
 *
 * This happens when the same playerId connects from a different browser tab
 * or device, implementing the "single active connection" pattern.
 */
export default function SessionTakenOverModal({ show, gameCode }) {
  const navigate = useNavigate();

  const handleReturnHome = () => {
    navigate('/', { replace: true });
  };

  const handleTakeOver = () => {
    // Refresh the page to create a new connection and take over again
    window.location.reload();
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="bg-gray-800 rounded-lg p-8 max-w-md w-full text-white shadow-2xl"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          >
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center">
                <svg
                  className="w-10 h-10 text-gray-900"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>

            {/* Title */}
            <h2 className="text-2xl font-bold text-center mb-4">
              Session Moved
            </h2>

            {/* Message */}
            <p className="text-gray-300 text-center mb-6">
              You joined this game from another tab or device.
            </p>
            <p className="text-gray-400 text-sm text-center mb-8">
              This tab has been disconnected to prevent duplicate connections.
            </p>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <button
                onClick={handleReturnHome}
                className="green-btn w-full py-3 px-6 rounded-lg font-semibold transition-all hover:scale-105"
              >
                Return to Home
              </button>
              <button
                onClick={handleTakeOver}
                className="bg-gray-700 hover:bg-gray-600 text-white w-full py-3 px-6 rounded-lg font-semibold transition-all"
              >
                Take Over Again (Refresh)
              </button>
            </div>

            {/* Helper text */}
            <p className="text-gray-500 text-xs text-center mt-6">
              Tip: Keep only one tab open per player to avoid this message.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
