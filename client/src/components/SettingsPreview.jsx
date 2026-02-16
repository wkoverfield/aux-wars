import React from "react";
import settingsIcon from "../assets/settings-btn.svg";

/**
 * SettingsPreview component displays current game settings in a compact inline format.
 * Designed to sit next to the "Players" header without taking extra vertical space.
 *
 * @param {Object} props - Component props
 * @param {Object} props.settings - Current game settings
 * @param {boolean} props.isHost - Whether current player is host
 * @param {Function} props.onEdit - Callback to open settings modal
 * @returns {JSX.Element} Rendered component
 */
export default function SettingsPreview({ settings, isHost, onEdit }) {
  const { numberOfRounds, roundLength, snippetDuration } = settings || {};

  // Format compact display
  const formatTime = (seconds) => {
    if (seconds === 0) return "∞";
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
    return `${seconds}s`;
  };

  const rounds = numberOfRounds || 3;
  const snippet = formatTime(snippetDuration ?? 30);
  const selection = formatTime(roundLength ?? 60);

  return (
    <button
      onClick={onEdit}
      className="flex items-center gap-2 text-gray-400 hover:text-gray-300 transition-colors"
      title={isHost ? "Edit settings" : "View settings"}
    >
      <span className="text-xs">
        {rounds} rds · {snippet} · {selection}
      </span>
      <img src={settingsIcon} alt="Settings" className="w-5 h-5" />
    </button>
  );
}
