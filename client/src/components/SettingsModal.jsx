import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGame } from "../services/GameContext";
// import { useSocket } from "../services/SocketProvider";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useToast } from "../contexts/ToastContext";
import PromptCategory from "./PromptCategory";
import CustomPromptInput from "./CustomPromptInput";
import { promptCategories } from "../data/promptCategories";
import { getSavedSettings } from "../hooks/useSettingsPersistence";

/**
 * SettingsModal component for configuring game settings.
 * 
 * @param {Object} props - Component props
 * @param {boolean} props.showModal - Controls modal visibility
 * @param {Function} props.onClose - Callback for closing the modal
 * @param {string} props.gameCode - Current game code
 * @returns {JSX.Element|null} Rendered component or null if not visible
 */
export default function SettingsModal({ showModal, onClose, gameCode, isHost = false }) {
  const { state, dispatch } = useGame();
  // const socket = useSocket();
  const updateSettingsMutation = useMutation(api.game.rooms.updateSettings);
  const { showToast } = useToast();
  
  // For hosts creating new games, use saved settings. For joining players, use game state.
  const savedSettings = isHost ? getSavedSettings() : null;
  const [rounds, setRounds] = useState(state.numberOfRounds);
  const [selectedPrompts, setSelectedPrompts] = useState(state.selectedPrompts);
  const [customPrompts, setCustomPrompts] = useState(savedSettings?.customPrompts || []);

  // Sync local state if game context changes externally
  useEffect(() => {
    setRounds(state.numberOfRounds);
    setSelectedPrompts(state.selectedPrompts);
  }, [state.numberOfRounds, state.selectedPrompts]);

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    if (showModal) document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showModal, onClose]);

  // Initialize with saved settings only for hosts on first render
  useEffect(() => {
    if (isHost && savedSettings && showModal) {
      if (savedSettings.numberOfRounds) setRounds(savedSettings.numberOfRounds);
      if (savedSettings.selectedPrompts) setSelectedPrompts(savedSettings.selectedPrompts);
    }
  }, [showModal]); // Only on modal open

  /**
   * Toggles a prompt in the selected prompts list
   * @param {string} prompt - Prompt to toggle
   */
  const togglePrompt = (prompt) => {
    if (selectedPrompts.includes(prompt)) {
      setSelectedPrompts(selectedPrompts.filter((p) => p !== prompt));
    } else {
      setSelectedPrompts([...selectedPrompts, prompt]);
    }
  };
  
  /**
   * Selects or deselects all prompts in a category
   * @param {Array} prompts - Array of prompts to select/deselect
   * @param {boolean} select - Whether to select or deselect
   */
  const handleSelectAll = (prompts, select) => {
    if (select) {
      const newPrompts = [...new Set([...selectedPrompts, ...prompts])];
      setSelectedPrompts(newPrompts);
    } else {
      setSelectedPrompts(selectedPrompts.filter(p => !prompts.includes(p)));
    }
  };
  
  /**
   * Adds a custom prompt
   * @param {string} prompt - The custom prompt to add
   */
  const handleAddCustomPrompt = (prompt) => {
    const newCustomPrompts = [...customPrompts, prompt];
    setCustomPrompts(newCustomPrompts);
    setSelectedPrompts([...selectedPrompts, prompt]);
  };
  
  /**
   * Removes a custom prompt
   * @param {number} index - Index of the prompt to remove
   */
  const handleRemoveCustomPrompt = (index) => {
    const promptToRemove = customPrompts[index];
    const newCustomPrompts = customPrompts.filter((_, i) => i !== index);
    setCustomPrompts(newCustomPrompts);
    setSelectedPrompts(selectedPrompts.filter(p => p !== promptToRemove));
  };

  /**
   * Applies the current settings to the game
   */
  const applySettings = () => {
    // Validate settings
    if (selectedPrompts.length < 5) {
      showToast("Please select at least 5 prompts", "warning");
      return;
    }
    
    if (selectedPrompts.length > 20) {
      showToast("Please select no more than 20 prompts", "warning");
      return;
    }
    
    // Update local game context
    dispatch({ type: "SET_ROUNDS", payload: rounds });
    dispatch({ type: "SET_SELECTED_PROMPTS", payload: selectedPrompts });
    
    // Save settings to localStorage for future games
    localStorage.setItem('aux-wars-settings', JSON.stringify({
      numberOfRounds: rounds,
      selectedPrompts,
      customPrompts
    }));
    
    // Update settings in Convex
    updateSettingsMutation({ code: gameCode, numberOfRounds: rounds, roundLength: 30, selectedPrompts });
    onClose();
  };

  return (
    <AnimatePresence>
      {showModal && (
        <motion.div 
          className="settings-modal z-50 fixed inset-0 flex items-center justify-center"
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
            className="relative w-full max-w-xl mx-4 bg-[#1a1a1a] rounded-lg shadow-2xl flex flex-col" 
            style={{ maxHeight: '85vh' }}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ 
              type: "spring",
              stiffness: 300,
              damping: 30
            }}
          >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-gray-700">
          <h2 className="text-2xl font-bold text-white mb-1">Game Settings</h2>
          <p className="text-gray-400 text-sm">Customize your game experience</p>
        </div>
        
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {/* Number of rounds */}
          <div className="mb-6">
            <label className="text-sm font-semibold text-white block mb-2">
              Number of Rounds
            </label>
            <input
              type="number"
              min="1"
              max="10"
              className="w-full rounded-md bg-[#242424] text-white p-3 focus:outline-none focus:ring-2 focus:ring-green-500"
              value={rounds}
              onChange={(e) => setRounds(parseInt(e.target.value) || 1)}
            />
          </div>
          
          {/* Prompt selection */}
          <div>
            <div className="flex justify-between items-baseline mb-4">
              <label className="text-sm font-semibold text-white">
                Select Prompts
              </label>
              <span className="text-xs text-gray-400">
                {selectedPrompts.length} selected (min: 5, max: 20)
              </span>
            </div>
            
            {/* Custom prompts */}
            <CustomPromptInput
              customPrompts={customPrompts}
              onAddPrompt={handleAddCustomPrompt}
              onRemovePrompt={handleRemoveCustomPrompt}
              maxPrompts={10}
            />
            
            {/* Prompt categories */}
            <div className="space-y-3">
              {promptCategories.map((category) => (
                <PromptCategory
                  key={category.id}
                  category={category}
                  selectedPrompts={selectedPrompts}
                  onTogglePrompt={togglePrompt}
                  onSelectAll={handleSelectAll}
                />
              ))}
            </div>
          </div>
        </div>
        
        {/* Fixed action buttons */}
        <div className="p-6 pt-4 border-t border-gray-700 bg-[#1a1a1a]">
          <div className="flex flex-col gap-3">
            <button
              onClick={applySettings}
              className="w-full py-3 green-btn rounded-md text-black font-semibold transition-all hover:scale-[1.02]"
              disabled={selectedPrompts.length < 5 || selectedPrompts.length > 20}
            >
              Apply Settings
            </button>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-md text-white font-semibold bg-[#242424] hover:bg-[#1a1a1a] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
