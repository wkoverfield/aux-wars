import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
// GameContext removed - using Convex queries directly
// import { useSocket } from "../services/SocketProvider";
import { useMutation, useQuery } from "convex/react";
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
export default function SettingsModal({ showModal, onClose, gameCode, isHost = false, playerId }) {
  const roomQuery = useQuery(api.game.rooms.getRoomByCode, gameCode ? { code: gameCode } : 'skip');
  // const socket = useSocket();
  const updateSettingsMutation = useMutation(api.game.rooms.updateSettings);
  const addCustomPromptMutation = useMutation(api.game.rooms.addCustomPrompt);
  const removeCustomPromptMutation = useMutation(api.game.rooms.removeCustomPrompt);
  const { showToast } = useToast();

  // Extract settings from room data
  const room = roomQuery?.room || roomQuery;
  const roomSettings = room?.settings;

  // For hosts creating new games, use saved settings. For joining players, use room state.
  const savedSettings = isHost ? getSavedSettings() : null;
  const [rounds, setRounds] = useState(roomSettings?.numberOfRounds || 3);
  const [selectedPrompts, setSelectedPrompts] = useState(roomSettings?.selectedPrompts || []);
  // Shared custom prompts, reactive per room
  const roomCustomPrompts = useQuery(
    api.game.rooms.getCustomPrompts,
    gameCode ? { code: gameCode } : 'skip'
  );

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    if (showModal) document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showModal, onClose]);

  // Load fresh from database when modal opens (not while editing)
  // This ensures players see the latest settings from other players
  useEffect(() => {
    if (!showModal) return;

    // Always load from database (single source of truth)
    if (roomSettings) {
      setRounds(roomSettings.numberOfRounds);
      setSelectedPrompts(roomSettings.selectedPrompts);
    }

    // Merge custom prompts into selection
    if (Array.isArray(roomCustomPrompts) && roomCustomPrompts.length > 0) {
      setSelectedPrompts((prev) => {
        const next = new Set(prev);
        roomCustomPrompts.forEach((p) => next.add(p));
        return Array.from(next);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal]); // Only reload when modal opens, not when database updates during editing

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
  const handleAddCustomPrompt = async (prompt) => {
    const text = (prompt || '').trim();
    if (!text) return;
    if (Array.isArray(roomCustomPrompts) && roomCustomPrompts.length >= 10) {
      showToast("Max 10 custom prompts per lobby", "warning");
      return;
    }
    try {
      await addCustomPromptMutation({ code: gameCode, text, createdBy: "anon" });
      setSelectedPrompts((prev) => [...new Set([...prev, text])]);
    } catch (_e) {
      showToast("Failed to add prompt", "error");
    }
  };
  
  /**
   * Removes a custom prompt
   * @param {number} index - Index of the prompt to remove
   */
  const handleRemoveCustomPrompt = async (index) => {
    if (!Array.isArray(roomCustomPrompts)) return;
    const promptToRemove = roomCustomPrompts[index];
    if (!promptToRemove) return;
    try {
      await removeCustomPromptMutation({ code: gameCode, text: promptToRemove, playerId });
      setSelectedPrompts((prev) => prev.filter((p) => p !== promptToRemove));
    } catch (_e) {
      showToast("Failed to remove prompt", "error");
    }
  };

  /**
   * Applies the current settings to the game
   */
  const applySettings = async () => {
    // Validate settings
    if (selectedPrompts.length < 5) {
      showToast("Please select at least 5 prompts", "warning");
      return;
    }

    if (selectedPrompts.length > 20) {
      showToast("Please select no more than 20 prompts", "warning");
      return;
    }

    // Save settings to localStorage for future games
    localStorage.setItem('aux-wars-settings', JSON.stringify({
      numberOfRounds: rounds,
      selectedPrompts
    }));

    // Update settings in Convex and wait for completion (host only)
    try {
      await updateSettingsMutation({
        code: gameCode,
        playerId,
        numberOfRounds: rounds,
        roundLength: 30,
        selectedPrompts
      });
      onClose(); // Only close after successful update
    } catch (error) {
      showToast("Failed to update settings. Please try again.", "error");
    }
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
              customPrompts={Array.isArray(roomCustomPrompts) ? roomCustomPrompts : []}
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
