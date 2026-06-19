import React from "react";
import searchIcon from "../assets/search-icon.svg";

/**
 * SearchBar component provides a styled search input with an icon.
 * For readonly mode, displays icon above text in vertical layout.
 * For editable mode, displays horizontal search bar.
 *
 * @param {Object} props - Component props
 * @param {string} props.value - Current input value
 * @param {Function} props.onChange - Change handler for input
 * @param {string} [props.placeholder=""] - Placeholder text for input
 * @param {boolean} [props.readOnly=false] - Whether the input is read-only
 * @returns {JSX.Element} Rendered component
 */
export default function SearchBar({
  value,
  onChange,
  placeholder = "",
  readOnly = false,
}) {
  // Readonly mode: Clean text display without icon
  if (readOnly) {
    return (
      <div className="search-area flex justify-center w-full">
        <div className="search-bar flex items-center justify-center rounded-md">
          <div className="text-white opacity-50 text-center break-words text-lg md:text-xl w-full" data-ph-mask>
            {value}
          </div>
        </div>
      </div>
    );
  }

  // Editable mode: Horizontal layout with search input
  return (
    <div className="search-area flex justify-center w-full">
      <div className="search-bar flex gap-2.5 rounded-md">
        <img src={searchIcon} alt="Search Icon" className="w-5 flex-shrink-0" />
        <input
          type="text"
          className="w-full text-white focus:outline-none"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
