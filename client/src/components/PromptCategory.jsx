import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PromptTag from './PromptTag';

/**
 * PromptCategory component displays an expandable category of prompts
 * 
 * @param {Object} props - Component props
 * @param {Object} props.category - Category object with id, name, icon, and prompts
 * @param {Array} props.selectedPrompts - Currently selected prompts
 * @param {Function} props.onTogglePrompt - Callback when a prompt is toggled
 * @param {Function} props.onSelectAll - Callback to select all prompts in category
 * @returns {JSX.Element} Rendered component
 */
export default function PromptCategory({ category, selectedPrompts, onTogglePrompt, onSelectAll }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Calculate how many prompts in this category are selected
  const selectedCount = category.prompts.filter(prompt => 
    selectedPrompts.includes(prompt)
  ).length;
  const allSelected = selectedCount === category.prompts.length;
  
  return (
    <div className="mb-4 bg-[#242424] rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#1a1a1a] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{category.icon}</span>
          <div className="text-left">
            <h3 className="text-white font-semibold">{category.name}</h3>
            <p className="text-sm text-gray-400">
              {selectedCount}/{category.prompts.length} selected
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
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-gray-400">
                  {category.prompts.length} prompts
                </span>
                <button
                  onClick={() => onSelectAll(category.prompts, !allSelected)}
                  className="text-sm text-green-400 hover:text-green-300 transition-colors"
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {category.prompts.map((prompt) => (
                  <PromptTag
                    key={prompt}
                    label={prompt}
                    selected={selectedPrompts.includes(prompt)}
                    onClick={() => onTogglePrompt(prompt)}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}