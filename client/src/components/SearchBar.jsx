import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import searchIcon from "../assets/search-icon.svg";

/**
 * SearchBar component provides a styled search input with an icon.
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
  const textRef = useRef(null);
  const containerRef = useRef(null);
  const [shouldScroll, setShouldScroll] = React.useState(false);
  const [scrollDistance, setScrollDistance] = React.useState(0);

  useEffect(() => {
    if (readOnly && textRef.current && containerRef.current) {
      const textWidth = textRef.current.scrollWidth;
      const containerWidth = containerRef.current.offsetWidth - 30; // Account for icon
      const needsScroll = textWidth > containerWidth;
      setShouldScroll(needsScroll);
      if (needsScroll) {
        setScrollDistance(-(textWidth - containerWidth + 20)); // Add padding
      }
    }
  }, [value, readOnly]);

  if (readOnly && shouldScroll) {
    return (
      <div className="search-area flex justify-center w-full">
        <div className="search-bar flex gap-2.5 rounded-md overflow-hidden" ref={containerRef}>
          <img src={searchIcon} alt="Search Icon" className="w-5 flex-shrink-0" />
          <div className="relative overflow-hidden flex-1">
            <motion.div
              ref={textRef}
              className="text-white opacity-50 whitespace-nowrap text-lg md:text-xl"
              animate={{ x: [0, scrollDistance, 0] }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut",
                repeatDelay: 2
              }}
            >
              {value}
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="search-area flex justify-center w-full overflow-x-auto">
      <div className="search-bar flex gap-2.5 rounded-md">
        <img src={searchIcon} alt="Search Icon" className="w-5 flex-shrink-0" />
        <input
          type="text"
          className={
            readOnly
              ? "w-full text-white opacity-50 focus:outline-none whitespace-nowrap text-lg md:text-xl"
              : "w-full text-white focus:outline-none"
          }
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
