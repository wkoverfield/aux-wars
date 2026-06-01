import { motion, AnimatePresence } from 'framer-motion';

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
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div 
            className="absolute inset-0 bg-black/70 backdrop-blur-sm" 
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          
          {/* Modal content */}
          <motion.div 
            className="relative w-full max-w-2xl mx-auto bg-[#1a1a1a] rounded-lg shadow-2xl flex flex-col" 
            style={{ maxHeight: '85vh' }}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ 
              type: "spring",
              stiffness: 300,
              damping: 30
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 pb-4 border-b border-gray-700">
              <h2 className="text-2xl font-bold text-white mb-1">How to Play</h2>
              <p className="text-gray-400 text-sm">A quick guide to becoming an Aux Wars champion</p>
            </div>
        
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Section 1: Game Flow */}
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full green-btn flex items-center justify-center text-black font-bold text-lg">1</div>
                  <h3 className="text-xl font-semibold text-white">Game Flow</h3>
                </div>
                <ul className="space-y-3 pl-11 text-gray-300">
                  <li className="flex items-start gap-3">
                    <span className="text-[#68d570] mt-1">▸</span>
                    <p>Join a lobby with friends using the game code provided by the host.</p>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-[#68d570] mt-1">▸</span>
                    <p>Each round, you'll get a creative prompt and a short time to search for the perfect song.</p>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-[#68d570] mt-1">▸</span>
                    <p>Listen to 30-second previews of everyone's submissions and rate them from 1 to 5.</p>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-[#68d570] mt-1">▸</span>
                    <p>The song with the highest average rating wins the round!</p>
                  </li>
                </ul>
              </section>

              {/* Section 2: Rules */}
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full green-btn flex items-center justify-center text-black font-bold text-lg">2</div>
                  <h3 className="text-xl font-semibold text-white">The Rules</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-11">
                  <div className="bg-[#242424] p-3 rounded-md border border-gray-700">
                    <p className="text-gray-300 text-sm">👥 A minimum of 3 players is required.</p>
                  </div>
                  <div className="bg-[#242424] p-3 rounded-md border border-gray-700">
                    <p className="text-gray-300 text-sm">⏱️ Submit your song before the timer runs out.</p>
                  </div>
                  <div className="bg-[#242424] p-3 rounded-md border border-gray-700">
                    <p className="text-gray-300 text-sm">🚫 You cannot rate your own song.</p>
                  </div>
                  <div className="bg-[#242424] p-3 rounded-md border border-gray-700">
                    <p className="text-gray-300 text-sm">🎵 No account needed — just jump in and play.</p>
                  </div>
                </div>
              </section>

              {/* Section 3: Pro Tips */}
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full green-btn flex items-center justify-center text-black font-bold text-lg">3</div>
                  <h3 className="text-xl font-semibold text-white">Pro Tips</h3>
                </div>
                <ul className="space-y-3 pl-11 text-gray-300">
                  <li className="bg-[#242424] p-4 rounded-md border-l-4 border-[#68d570]">
                    <p><strong>Match the Vibe:</strong> Think about how the song fits the prompt's mood, not just the lyrics.</p>
                  </li>
                  <li className="bg-[#242424] p-4 rounded-md border-l-4 border-[#68d570]">
                    <p><strong>Be Creative:</strong> Sometimes the most unexpected song choice is a winner.</p>
                  </li>
                  <li className="bg-[#242424] p-4 rounded-md border-l-4 border-[#68d570]">
                    <p><strong>Act Fast:</strong> Use the search preview to quickly listen and find the perfect snippet.</p>
                  </li>
                </ul>
              </section>

              <div className="mt-6 p-4 bg-green-500/10 rounded-lg border border-green-500/30 text-center">
                <p className="font-semibold text-white">Ready to battle? Let the best song win! 🏆</p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 pt-4 border-t border-gray-700 bg-[#1a1a1a]">
              <button
                onClick={onClose}
                className="w-full py-3 green-btn rounded-md text-black font-semibold transition-all hover:scale-[1.02]"
              >
                Got it!
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
 