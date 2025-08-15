import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * CustomPromptInput component for adding custom prompts
 * 
 * @param {Object} props - Component props
 * @param {Array} props.customPrompts - Current custom prompts
 * @param {Function} props.onAddPrompt - Callback when adding a prompt
 * @param {Function} props.onRemovePrompt - Callback when removing a prompt
 * @param {number} props.maxPrompts - Maximum number of custom prompts allowed
 * @returns {JSX.Element} Rendered component
 */
export default function CustomPromptInput({ customPrompts = [], onAddPrompt, onRemovePrompt, maxPrompts = 10 }) {
  const [newPrompt, setNewPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  
  const canAddMore = customPrompts.length < maxPrompts;
  
  const handleSubmit = (e) => {
    e.preventDefault();
    if (newPrompt.trim() && canAddMore) {
      onAddPrompt(newPrompt.trim());
      setNewPrompt('');
    }
  };
  
  return (
    <div className="mb-4 bg-[#242424] rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#1a1a1a] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">✏️</span>
          <div className="text-left">
            <h3 className="text-white font-semibold">Custom Prompts</h3>
            <p className="text-sm text-gray-400">
              {customPrompts.length}/{maxPrompts} created
            </p>
          </div>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </motion.div>
      </button>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="px-4 pb-4 pt-2 border-t border-gray-600">
              {/* Add new prompt form */}
              <form onSubmit={handleSubmit} className="mb-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                    placeholder="Enter your custom prompt..."
                    className="flex-1 px-3 py-2 bg-[#242424] text-white rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                    maxLength={100}
                    disabled={!canAddMore}
                  />
                  <button
                    type="submit"
                    disabled={!newPrompt.trim() || !canAddMore}
                    className="px-4 py-2 bg-green-500 text-black rounded-md font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-400 transition-colors"
                  >
                    Add
                  </button>
                </div>
                {!canAddMore && (
                  <p className="text-xs text-red-400 mt-1">
                    Maximum {maxPrompts} custom prompts allowed
                  </p>
                )}
              </form>
              
              {/* List of custom prompts */}
              {customPrompts.length > 0 && (
                <div className="space-y-2">
                  {customPrompts.map((prompt, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="flex items-center justify-between p-2 bg-[#1a1a1a] rounded-md"
                    >
                      <span className="text-white text-sm flex-1 mr-2">{prompt}</span>
                      <button
                        onClick={() => onRemovePrompt(index)}
                        className="text-red-400 hover:text-red-300 transition-colors"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}