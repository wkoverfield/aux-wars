import { motion, AnimatePresence } from 'framer-motion';
import recordLogo from './record-logo.svg';

/**
 * HowToPlayModal component displays game instructions in a modal overlay.
 * Matches the app's styling and uses Framer Motion for animations.
 * 
 * @param {Object} props - Component props
 * @param {boolean} props.showModal - Whether the modal is visible
 * @param {Function} props.onClose - Callback to close the modal
 * @returns {JSX.Element} Rendered component
 */
export default function HowToPlayModal({ showModal, onClose }) {
  return (
    <AnimatePresence>
      {showModal && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
        >
          <motion.div 
            initial={{ scale: 0.8, opacity: 0, y: 50 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 50 }}
            transition={{ type: "spring", damping: 25, stiffness: 500 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-[#242424] rounded-2xl p-6 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl border border-gray-800"
          >
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <motion.img 
                  src={recordLogo} 
                  alt="Record" 
                  className="w-10 h-10"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                />
                <h2 className="text-3xl font-bold text-white">How to Play</h2>
              </div>
              <motion.button 
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </motion.button>
            </div>

            <div className="space-y-6 text-white flex-1">
              <motion.section
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-[#1db954] rounded-lg flex items-center justify-center text-white font-bold">1</div>
                  <h3 className="text-xl font-semibold text-[#1db954]">Game Flow</h3>
                </div>
                <div className="space-y-3 ml-10">
                  <motion.div whileHover={{ x: 5 }} className="flex items-start gap-3">
                    <span className="text-[#1db954] mt-1">▸</span>
                    <p className="text-gray-300">Join a lobby with friends using the game code provided by the host</p>
                  </motion.div>
                  <motion.div whileHover={{ x: 5 }} className="flex items-start gap-3">
                    <span className="text-[#1db954] mt-1">▸</span>
                    <p className="text-gray-300">Each round, you'll receive a creative prompt and have time to search YouTube for the perfect song</p>
                  </motion.div>
                  <motion.div whileHover={{ x: 5 }} className="flex items-start gap-3">
                    <span className="text-[#1db954] mt-1">▸</span>
                    <p className="text-gray-300">Listen to 30-second previews of all submissions and rate them with 1-5 records</p>
                  </motion.div>
                  <motion.div whileHover={{ x: 5 }} className="flex items-start gap-3">
                    <span className="text-[#1db954] mt-1">▸</span>
                    <p className="text-gray-300">The song with the most records wins the round!</p>
                  </motion.div>
                </div>
              </motion.section>

              <motion.section
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-[#1db954] rounded-lg flex items-center justify-center text-white font-bold">2</div>
                  <h3 className="text-xl font-semibold text-[#1db954]">Rules & Requirements</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-10">
                  <motion.div whileHover={{ scale: 1.05 }} className="bg-[#191414] p-3 rounded-lg border border-[#1db954]/20">
                    <p className="text-gray-300 text-sm">🎮 Minimum 3 players required</p>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.05 }} className="bg-[#191414] p-3 rounded-lg border border-[#1db954]/20">
                    <p className="text-gray-300 text-sm">⏱️ Submit songs before time runs out</p>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.05 }} className="bg-[#191414] p-3 rounded-lg border border-[#1db954]/20">
                    <p className="text-gray-300 text-sm">🚫 Can't rate your own song</p>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.05 }} className="bg-[#191414] p-3 rounded-lg border border-[#1db954]/20">
                    <p className="text-gray-300 text-sm">🎵 No account needed - uses YouTube</p>
                  </motion.div>
                </div>
              </motion.section>

              <motion.section
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-[#1db954] rounded-lg flex items-center justify-center text-white font-bold">3</div>
                  <h3 className="text-xl font-semibold text-[#1db954]">Pro Tips</h3>
                </div>
                <div className="space-y-3 ml-10">
                  <motion.div 
                    whileHover={{ x: 5 }} 
                    className="flex items-center gap-3 bg-[#191414] p-3 rounded-lg border-l-4 border-[#1db954]"
                  >
                    <span className="text-2xl">🎯</span>
                    <p className="text-gray-300">Match the vibe - think about how the song fits the prompt's mood</p>
                  </motion.div>
                  <motion.div 
                    whileHover={{ x: 5 }} 
                    className="flex items-center gap-3 bg-[#191414] p-3 rounded-lg border-l-4 border-[#1db954]"
                  >
                    <span className="text-2xl">🎨</span>
                    <p className="text-gray-300">Be creative - unexpected song choices often win!</p>
                  </motion.div>
                  <motion.div 
                    whileHover={{ x: 5 }} 
                    className="flex items-center gap-3 bg-[#191414] p-3 rounded-lg border-l-4 border-[#1db954]"
                  >
                    <span className="text-2xl">⚡</span>
                    <p className="text-gray-300">Act fast - use the search preview to quickly find the perfect track</p>
                  </motion.div>
                </div>
              </motion.section>

              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="mt-8 p-4 bg-[#1db954]/20 rounded-xl border border-[#1db954]/40"
              >
                <p className="text-center text-white font-semibold">Ready to become the ultimate Aux Wars champion? 🏆</p>
              </motion.section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
} 