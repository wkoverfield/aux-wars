import { motion, AnimatePresence } from 'framer-motion';

/**
 * Toast notification component with Spotify-themed styling
 * Displays temporary messages with different types (success, error, warning, info)
 */
export default function Toast({ message, type = 'info', onClose }) {
  // Color schemes for different toast types
  const typeStyles = {
    success: {
      borderColor: '#1db954',
      iconColor: '#1db954',
      icon: '✓'
    },
    error: {
      borderColor: '#ef4444',
      iconColor: '#ef4444',
      icon: '✕'
    },
    warning: {
      borderColor: '#f59e0b',
      iconColor: '#f59e0b',
      icon: '⚠'
    },
    info: {
      borderColor: '#3b82f6',
      iconColor: '#3b82f6',
      icon: 'ⓘ'
    }
  };

  const style = typeStyles[type] || typeStyles.info;

  return (
    <motion.div
      initial={{ opacity: 0, y: -50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] pointer-events-auto"
    >
      <div
        className="bg-[#242424] rounded-xl px-6 py-4 shadow-2xl border-2 flex items-center gap-3 min-w-[300px] max-w-[500px]"
        style={{ borderColor: style.borderColor }}
      >
        <span 
          className="text-2xl font-bold"
          style={{ color: style.iconColor }}
        >
          {style.icon}
        </span>
        <p className="text-white text-sm md:text-base flex-1">{message}</p>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors ml-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </motion.div>
  );
}