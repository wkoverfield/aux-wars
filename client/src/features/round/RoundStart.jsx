import React from "react";
import SearchBar from "../../components/SearchBar";
import nextIcon from "../../assets/next-icon.svg";

/**
 * RoundStart component displays the current prompt and provides a button to start song selection.
 * 
 * @param {Object} props - Component props
 * @param {string} props.currentPrompt - The current game prompt to display
 * @param {Function} props.onStartSelection - Callback function when user clicks to start song selection
 * @returns {JSX.Element} Rendered component
 */
export default function RoundStart({ currentPrompt, onStartSelection }) {
  return (
    <div className="flex flex-col items-center justify-center gap-12 max-w-4xl mx-auto px-4">
      <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-center text-white">The prompt is:</h1>

      <div className="w-full max-w-4xl px-4">
        <SearchBar
          value={currentPrompt || ""}
          onChange={() => {}}
          readOnly
        />
      </div>

      <button
        onClick={onStartSelection}
        className="flex items-center justify-center gap-2 py-3 px-6 rounded-md text-white font-semibold cursor-pointer bg-[#242424] hover:bg-[#191414] transition-colors text-lg"
      >
        <span>Select Song</span>
        <img src={nextIcon} alt="Arrow Right" className="w-5 h-5 pt-0.5" />
      </button>
    </div>
  );
} 