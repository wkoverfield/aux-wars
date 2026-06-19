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
import { captureGameEvent, gameProperties } from "../services/analytics";

const MIN_PROMPT_POOL_SIZE = 5;
const MAX_PROMPT_POOL_SIZE = 50;
const PROMPT_PACKS_STORAGE_KEY = "aux-wars-prompt-packs-v1";

function loadSavedPromptPacks() {
  try {
    const raw = localStorage.getItem(PROMPT_PACKS_STORAGE_KEY);
    if (!raw) return [];
    const packs = JSON.parse(raw);
    return Array.isArray(packs)
      ? packs.filter((pack) => pack?.id && pack?.name && Array.isArray(pack?.prompts))
      : [];
  } catch {
    return [];
  }
}

function savePromptPacks(packs) {
  try {
    localStorage.setItem(PROMPT_PACKS_STORAGE_KEY, JSON.stringify(packs));
    return true;
  } catch {
    return false;
  }
}

function createPromptPackId() {
  return globalThis.crypto?.randomUUID?.() || `pack-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDurationLabel(seconds) {
  if (seconds === 0) return "No limit";
  if (seconds >= 60) {
    const minutes = seconds / 60;
    return `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)} min`;
  }
  return `${seconds}s`;
}

/**
 * SettingsModal component for configuring game settings.
 *
 * @param {Object} props - Component props
 * @param {boolean} props.showModal - Controls modal visibility
 * @param {Function} props.onClose - Callback for closing the modal
 * @param {string} props.gameCode - Current game code
 * @returns {JSX.Element|null} Rendered component or null if not visible
 */
export default function SettingsModal({ showModal, onClose, gameCode, playerId, connectionId, isHost = false }) {
  const roomQuery = useQuery(api.game.rooms.getRoomByCode, gameCode ? { code: gameCode } : 'skip');
  // const socket = useSocket();
  const updateSettingsMutation = useMutation(api.game.rooms.updateSettings);
  const addCustomPromptMutation = useMutation(api.game.rooms.addCustomPrompt);
  const addCustomPromptsMutation = useMutation(api.game.rooms.addCustomPrompts);
  const removeCustomPromptMutation = useMutation(api.game.rooms.removeCustomPrompt);
  const { showToast } = useToast();

  // Extract settings from room data
  const room = roomQuery?.room || roomQuery;
  const roomSettings = room?.settings;

  const [rounds, setRounds] = useState(roomSettings?.numberOfRounds ?? 3);
  const [roundLength, setRoundLength] = useState(roomSettings?.roundLength ?? 60); // Song selection time limit
  const [snippetDuration, setSnippetDuration] = useState(roomSettings?.snippetDuration ?? 30); // Audio playback duration
  const [selectedPrompts, setSelectedPrompts] = useState(roomSettings?.selectedPrompts ?? []);
  const [enablePromptVoting, setEnablePromptVoting] = useState(roomSettings?.enablePromptVoting !== false); // default true
  const [anonymousMode, setAnonymousMode] = useState(roomSettings?.anonymousMode ?? false); // default false
  const [savedPromptPacks, setSavedPromptPacks] = useState(() => loadSavedPromptPacks());
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
      setRoundLength(roomSettings.roundLength ?? 60);
      setSnippetDuration(roomSettings.snippetDuration ?? 30);
      setSelectedPrompts(roomSettings.selectedPrompts);
      setEnablePromptVoting(roomSettings.enablePromptVoting !== false);
      setAnonymousMode(roomSettings.anonymousMode || false);
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
    if (!isHost) return;
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
    if (!isHost) return;
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
    if (Array.isArray(roomCustomPrompts) && roomCustomPrompts.length >= MAX_PROMPT_POOL_SIZE) {
      showToast(`Max ${MAX_PROMPT_POOL_SIZE} custom prompts per lobby`, "warning");
      return;
    }
    try {
      const result = await addCustomPromptMutation({ code: gameCode, text, createdBy: playerId || "anon" });
      if (result?.success === false) {
        showToast(result.message || "Failed to add prompt", "warning");
        return;
      }
      captureGameEvent("custom_prompt_added", gameProperties({
        code: gameCode,
        room,
        session: { playerId },
        extra: {
          prompt_length: text.length,
          custom_prompt_count: (Array.isArray(roomCustomPrompts) ? roomCustomPrompts.length : 0) + 1,
          selected_by_host_pool: result?.selected,
        },
      }));
      setSelectedPrompts((prev) => [...new Set([...prev, text])].slice(0, MAX_PROMPT_POOL_SIZE));
      if (result?.selected === 0) {
        showToast(`Added prompt. Host prompt pool is full at ${MAX_PROMPT_POOL_SIZE}.`, "warning");
      }
    } catch (_e) {
      showToast("Failed to add prompt", "error");
    }
  };

  const handleSavePromptPack = (packName) => {
    const prompts = Array.isArray(roomCustomPrompts)
      ? [...new Set(roomCustomPrompts.map((prompt) => prompt.trim()).filter(Boolean))]
      : [];
    const name = (packName || '').trim();

    if (!name) {
      showToast("Name your prompt pack first", "warning");
      return;
    }
    if (prompts.length === 0) {
      showToast("Add custom prompts before saving a pack", "warning");
      return;
    }

    const nowIso = new Date().toISOString();
    const existingIndex = savedPromptPacks.findIndex(
      (pack) => pack.name.trim().toLowerCase() === name.toLowerCase()
    );
    const nextPack = {
      id: existingIndex >= 0 ? savedPromptPacks[existingIndex].id : createPromptPackId(),
      name,
      prompts,
      createdAt: existingIndex >= 0 ? savedPromptPacks[existingIndex].createdAt : nowIso,
      updatedAt: nowIso,
    };
    const nextPacks =
      existingIndex >= 0
        ? savedPromptPacks.map((pack, index) => (index === existingIndex ? nextPack : pack))
        : [nextPack, ...savedPromptPacks];

    setSavedPromptPacks(nextPacks);
    if (savePromptPacks(nextPacks)) {
      captureGameEvent("prompt_pack_saved", gameProperties({
        code: gameCode,
        room,
        session: { playerId },
        extra: {
          prompt_count: prompts.length,
          pack_count: nextPacks.length,
          replaced_existing_pack: existingIndex >= 0,
        },
      }));
      showToast(`Saved "${name}" (${prompts.length} prompts)`, "success");
    } else {
      setSavedPromptPacks(savedPromptPacks);
      showToast("Couldn't save pack in this browser", "error");
    }
  };

  const handleLoadPromptPack = async (packId) => {
    const pack = savedPromptPacks.find((item) => item.id === packId);
    if (!pack) return;
    const existingPrompts = new Set(Array.isArray(roomCustomPrompts) ? roomCustomPrompts : []);
    const remainingSlots = Math.max(0, MAX_PROMPT_POOL_SIZE - existingPrompts.size);
    const promptsThatCanFit = pack.prompts
      .map((prompt) => prompt.trim())
      .filter((prompt) => prompt && !existingPrompts.has(prompt))
      .slice(0, remainingSlots);

    try {
      const result = await addCustomPromptsMutation({
        code: gameCode,
        prompts: pack.prompts,
        createdBy: playerId || "anon",
      });
      if (result?.success === false) {
        showToast(result.message || "Failed to load prompt pack", "warning");
        return;
      }
      captureGameEvent("prompt_pack_loaded", gameProperties({
        code: gameCode,
        room,
        session: { playerId },
        extra: {
          pack_prompt_count: pack.prompts.length,
          added_count: result?.added || 0,
          skipped_count: result?.skipped || 0,
          maxed_out: Boolean(result?.maxedOut),
        },
      }));
      setSelectedPrompts((prev) => [...new Set([...prev, ...promptsThatCanFit])].slice(0, MAX_PROMPT_POOL_SIZE));

      if (result?.maxedOut) {
        showToast(`Added ${result.added} prompts. Room is full at ${MAX_PROMPT_POOL_SIZE}.`, "warning");
      } else if (result?.added > 0 && result?.selected === 0) {
        showToast(`Added ${result.added} prompts. Host prompt pool is full at ${MAX_PROMPT_POOL_SIZE}.`, "warning");
      } else if (result?.added > 0) {
        showToast(`Added ${result.added} prompts from "${pack.name}"`, "success");
      } else {
        showToast("Those prompts are already in this lobby", "info");
      }
    } catch (error) {
      console.error("Failed to load prompt pack:", error);
      showToast("Failed to load prompt pack", "error");
    }
  };

  const handleDeletePromptPack = (packId) => {
    const nextPacks = savedPromptPacks.filter((pack) => pack.id !== packId);
    setSavedPromptPacks(nextPacks);
    if (savePromptPacks(nextPacks)) {
      captureGameEvent("prompt_pack_deleted", gameProperties({
        code: gameCode,
        room,
        session: { playerId },
        extra: { pack_count: nextPacks.length },
      }));
      showToast("Prompt pack deleted", "success");
    } else {
      setSavedPromptPacks(savedPromptPacks);
      showToast("Couldn't update saved packs", "error");
    }
  };

  /**
   * Removes a custom prompt
   * @param {number} index - Index of the prompt to remove
   */
  const handleRemoveCustomPrompt = async (index) => {
    if (!isHost) {
      showToast("Only the host can remove prompts", "warning");
      return;
    }
    if (!Array.isArray(roomCustomPrompts)) return;
    if (!playerId || !connectionId) {
      showToast("Session expired. Please refresh and try again.", "error");
      return;
    }
    const promptToRemove = roomCustomPrompts[index];
    if (!promptToRemove) return;
    try {
      await removeCustomPromptMutation({ code: gameCode, text: promptToRemove, playerId, connectionId });
      setSelectedPrompts((prev) => prev.filter((p) => p !== promptToRemove));
    } catch (_e) {
      showToast("Failed to remove prompt", "error");
    }
  };

  /**
   * Applies the current settings to the game
   */
  const applySettings = async () => {
    if (!isHost) {
      onClose();
      return;
    }

    // Validate session first
    if (!playerId) {
      showToast("Session expired. Please refresh the page.", "error");
      return;
    }

    // Validate settings
    if (selectedPrompts.length < MIN_PROMPT_POOL_SIZE) {
      showToast(`Please select at least ${MIN_PROMPT_POOL_SIZE} prompts`, "warning");
      return;
    }

    if (selectedPrompts.length > MAX_PROMPT_POOL_SIZE) {
      showToast(`Please select no more than ${MAX_PROMPT_POOL_SIZE} prompts`, "warning");
      return;
    }

    if (!playerId || !connectionId) {
      showToast("Session expired. Please refresh and try again.", "error");
      return;
    }

    // Save settings to localStorage for future games
    localStorage.setItem('aux-wars-settings', JSON.stringify({
      numberOfRounds: rounds,
      roundLength,
      snippetDuration,
      selectedPrompts,
      enablePromptVoting,
      anonymousMode
    }));

    // Update settings in Convex and wait for completion (host only)
    try {
      const result = await updateSettingsMutation({
        code: gameCode,
        playerId,
        connectionId,
        numberOfRounds: rounds,
        roundLength,
        snippetDuration,
        selectedPrompts,
        enablePromptVoting,
        anonymousMode
      });
      if (result?.success === false) {
        showToast(result.message || "Failed to update settings. Please try again.", "warning");
        return;
      }
      captureGameEvent("settings_updated", gameProperties({
        code: gameCode,
        room,
        session: { playerId },
        extra: {
          rounds_total: rounds,
          song_selection_time: roundLength,
          clip_length: snippetDuration,
          prompt_pool_size: selectedPrompts.length,
          prompt_voting_enabled: enablePromptVoting,
          anonymous_mode: anonymousMode,
          custom_prompt_count: Array.isArray(roomCustomPrompts) ? roomCustomPrompts.length : undefined,
        },
      }));
      onClose(); // Only close after successful update
    } catch (error) {
      console.error("Settings update failed:", error);
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
	          <h2 className="text-2xl font-bold text-white mb-1">
	            {isHost ? "Game Settings" : "Custom Prompts"}
	          </h2>
	          <p className="text-gray-400 text-sm">
	            {isHost
	              ? "Customize your game experience"
	              : "Add prompt ideas for this lobby"}
	          </p>
	        </div>

	        {/* Scrollable content */}
	        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {isHost && (
            <>
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

	              {/* Song Selection Time */}
	              <div className="mb-6">
	                <label className="text-sm font-semibold text-white block mb-2">
	                  Song Selection Time
	                </label>
	                <p className="text-xs text-gray-400 mb-3">How long players have to pick their song</p>
	                <div className="grid grid-cols-3 gap-2">
	                  {[
	                    { value: 30, label: "30s" },
	                    { value: 60, label: "60s" },
	                    { value: 90, label: "90s" },
	                    { value: 120, label: "2 min" },
	                    { value: 180, label: "3 min" },
	                    { value: 0, label: "No Limit" },
	                  ].map(({ value, label }) => (
	                    <button
	                      key={value}
	                      type="button"
	                      onClick={() => setRoundLength(value)}
	                      className={`py-2 px-3 rounded-md text-sm font-medium transition-colors ${
	                        roundLength === value
	                          ? "bg-green-600 text-black"
	                          : "bg-[#242424] text-white hover:bg-[#333]"
	                      }`}
	                    >
	                      {label}
	                    </button>
	                  ))}
	                </div>
	              </div>

	              {/* Clip length — how much of the song plays. Only affects YouTube
	                  songs (full-song picks); iTunes/Deezer previews are fixed ~30s. */}
	              <div className="mb-6">
	                <label className="text-sm font-semibold text-white block mb-2">
	                  Clip Length
	                </label>
	                <p className="text-xs text-gray-400 mb-3">How long the chosen clip plays (YouTube songs)</p>
	                <div className="grid grid-cols-3 gap-2">
	                  {[
	                    { value: 15, label: "15s" },
	                    { value: 30, label: "30s" },
	                    { value: 45, label: "45s" },
	                    { value: 60, label: "60s" },
	                    { value: 90, label: "90s" },
	                    { value: 0, label: "Full Song" },
	                  ].map(({ value, label }) => (
	                    <button
	                      key={value}
	                      type="button"
	                      onClick={() => setSnippetDuration(value)}
	                      className={`py-2 px-3 rounded-md text-sm font-medium transition-colors ${
	                        snippetDuration === value
	                          ? "bg-green-600 text-black"
	                          : "bg-[#242424] text-white hover:bg-[#333]"
	                      }`}
	                    >
	                      {label}
	                    </button>
	                  ))}
	                </div>
	              </div>

	              {/* Game Mode Toggles */}
	              <div className="mb-6 space-y-4">
	                <label className="text-sm font-semibold text-white block mb-2">
	                  Game Modes
	                </label>

	                {/* Prompt Voting Toggle */}
	                <div
	                  className="flex items-center justify-between p-3 bg-[#242424] rounded-md cursor-pointer hover:bg-[#333] transition-colors"
	                  onClick={() => setEnablePromptVoting(!enablePromptVoting)}
	                >
	                  <div>
	                    <p className="text-white font-medium">Prompt Voting</p>
	                    <p className="text-xs text-gray-400">Let players vote to skip prompts</p>
	                  </div>
	                  <div className={`w-12 h-6 rounded-full p-1 transition-colors ${enablePromptVoting ? 'bg-green-600' : 'bg-gray-600'}`}>
	                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${enablePromptVoting ? 'translate-x-6' : 'translate-x-0'}`} />
	                  </div>
	                </div>

	                {/* Anonymous Mode Toggle */}
	                <div
	                  className="flex items-center justify-between p-3 bg-[#242424] rounded-md cursor-pointer hover:bg-[#333] transition-colors"
	                  onClick={() => setAnonymousMode(!anonymousMode)}
	                >
	                  <div>
	                    <p className="text-white font-medium">Anonymous Mode</p>
	                    <p className="text-xs text-gray-400">Hide who submitted songs during rating</p>
	                  </div>
	                  <div className={`w-12 h-6 rounded-full p-1 transition-colors ${anonymousMode ? 'bg-green-600' : 'bg-gray-600'}`}>
	                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${anonymousMode ? 'translate-x-6' : 'translate-x-0'}`} />
	                  </div>
	                </div>
	              </div>
            </>
          )}

          {!isHost && (
            <div className="mb-6 rounded-lg border border-gray-700 bg-[#202020] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Current Settings</h3>
                <span className="text-xs text-gray-500">Host managed</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Rounds</p>
                  <p className="mt-1 text-white">{rounds}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Song Pick Time</p>
                  <p className="mt-1 text-white">{formatDurationLabel(roundLength)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Clip Length</p>
                  <p className="mt-1 text-white">
                    {snippetDuration === 0 ? "Full song" : formatDurationLabel(snippetDuration)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Prompt Voting</p>
                  <p className="mt-1 text-white">{enablePromptVoting ? "On" : "Off"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Anonymous Mode</p>
                  <p className="mt-1 text-white">{anonymousMode ? "On" : "Off"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Prompt Pool</p>
                  <p className="mt-1 text-white">{selectedPrompts.length}/{MAX_PROMPT_POOL_SIZE}</p>
                </div>
              </div>
            </div>
          )}

          {/* Prompt selection */}
          <div>
	            <div className="flex justify-between items-baseline mb-4">
	              <label className="text-sm font-semibold text-white">
	                {isHost ? "Select Prompts" : "Prompt Ideas"}
	              </label>
	              {isHost && (
	                <span className="text-xs text-gray-400">
	                  {selectedPrompts.length} selected (min: {MIN_PROMPT_POOL_SIZE}, max: {MAX_PROMPT_POOL_SIZE})
	                </span>
	              )}
	            </div>

            {/* Custom prompts */}
            <CustomPromptInput
              customPrompts={Array.isArray(roomCustomPrompts) ? roomCustomPrompts : []}
              onAddPrompt={handleAddCustomPrompt}
              onRemovePrompt={handleRemoveCustomPrompt}
              maxPrompts={MAX_PROMPT_POOL_SIZE}
              savedPromptPacks={savedPromptPacks}
	              onSavePack={handleSavePromptPack}
	              onLoadPack={handleLoadPromptPack}
	              onDeletePack={handleDeletePromptPack}
	              canRemovePrompts={isHost}
	            />

	            {/* Prompt categories */}
	            {isHost && (
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
	            )}
	          </div>
	        </div>

        {/* Fixed action buttons */}
        <div className="p-6 pt-4 border-t border-gray-700 bg-[#1a1a1a]">
          <div className="flex flex-col gap-3">
	            {isHost && (selectedPrompts.length < MIN_PROMPT_POOL_SIZE || selectedPrompts.length > MAX_PROMPT_POOL_SIZE) && (
	              <p className="text-sm text-yellow-500 text-center">
	                {selectedPrompts.length < MIN_PROMPT_POOL_SIZE
	                  ? `Select at least ${MIN_PROMPT_POOL_SIZE} prompts (${selectedPrompts.length} selected)`
                  : `Maximum ${MAX_PROMPT_POOL_SIZE} prompts allowed (${selectedPrompts.length} selected)`
                }
              </p>
            )}
	            {isHost && (
	              <button
	                onClick={applySettings}
	                className="w-full py-3 green-btn rounded-md text-black font-semibold transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
	                disabled={selectedPrompts.length < MIN_PROMPT_POOL_SIZE || selectedPrompts.length > MAX_PROMPT_POOL_SIZE}
	              >
	                Apply Settings
	              </button>
	            )}
	            <button
	              onClick={onClose}
	              className="w-full py-3 rounded-md text-white font-semibold bg-[#242424] hover:bg-[#1a1a1a] transition-colors"
	            >
	              {isHost ? "Cancel" : "Close"}
	            </button>
          </div>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
