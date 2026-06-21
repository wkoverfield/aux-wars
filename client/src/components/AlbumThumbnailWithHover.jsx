import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * AlbumThumbnailWithHover component displays an album cover with hover effects.
 * On hover, it "pulls out" like a book from a shelf and shows song details.
 * 
 * @param {Object} props - Component props
 * @param {string} props.album - Album cover URL
 * @param {Object} props.song - Song object with name, artist, etc.
 * @param {number} props.index - Index for stacking position
 * @param {boolean} props.isStacked - Whether this is part of a stack
 * @param {string} props.size - Size variant: "large" or "small"
 * @param {number} props.stackOffset - Pixel offset for stacking
 * @returns {JSX.Element} Rendered component
 */
const AlbumThumbnailWithHover = React.memo(function AlbumThumbnailWithHover({ 
  album, 
  song, 
  index, 
  isStacked, 
  size = "small",
  stackOffset = 18 
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  
  // Size configurations
  const sizeClasses = {
    large: "w-16 h-16 sm:w-20 sm:h-20 md:w-28 md:h-28",
    small: "w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16"
  };
  
  // Calculate transform for stacking effect (no absolute positioning)
  const stackOffsetX = isStacked ? index * stackOffset : 0;
  

  return (
    <motion.div
      className="relative inline-block"
      style={{
        zIndex: isHovered ? 50 : (10 - index),
        marginLeft: isStacked && index > 0 ? `-${stackOffset}px` : '0'
      }}
      initial={{ opacity: 0, x: -stackOffsetX }}
      animate={{ 
        opacity: 1,
        x: -stackOffsetX,
        y: isHovered ? -8 : 0,
        scale: isHovered ? 1.1 : 1
      }}
      transition={{ 
        type: "spring", 
        stiffness: 120, 
        damping: 20,
        mass: 0.5
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      // Dismiss the tooltip on tap/click — a click that opens the setlist (or a
      // touch that emulates hover) would otherwise leave it stuck open. Bubbles,
      // so the parent's open-setlist onClick still fires.
      onClick={() => setIsHovered(false)}
    >
      <img
        src={album}
        alt={song?.name || "Album Cover"}
        className={`${sizeClasses[size]} rounded-${size === 'large' ? 'lg' : 'md'} shadow-lg cursor-pointer`}
        style={{
          boxShadow: isHovered 
            ? '0 8px 24px rgba(0,0,0,0.3)' 
            : '0 2px 8px rgba(0,0,0,0.15)',
          transition: 'box-shadow 0.3s ease'
        }}
      />
      
      {/* Tooltip */}
      <AnimatePresence>
        {isHovered && song && (
          <motion.div
            className={`absolute ${size === 'large' ? 'top-full mt-2' : 'top-full mt-1'} left-1/2 transform -translate-x-1/2 
                       bg-black/85 backdrop-blur-sm rounded-lg p-3 shadow-2xl z-50 whitespace-nowrap`}
            initial={{ opacity: 0, y: -10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.9 }}
            transition={{ 
              type: "spring",
              stiffness: 300,
              damping: 30,
              mass: 0.5
            }}
          >
            <div className="text-center">
              <p className="text-sm font-semibold text-white mb-1">{song.name}</p>
              <p className="text-xs text-gray-300">{song.artist}</p>
              {song.isRoundWinner && (
                <div className="mt-2 text-xs text-green-400 font-semibold">
                  🏆 Round Winner
                </div>
              )}
              {song.round && (
                <div className="mt-1 text-xs text-gray-400">
                  Round {song.round}
                </div>
              )}
            </div>
            
            {/* Tooltip arrow */}
            <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 w-0 h-0 
                           border-l-[6px] border-l-transparent 
                           border-r-[6px] border-r-transparent 
                           border-b-[6px] border-b-black/85"></div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for React.memo - only re-render if props actually changed
  return (
    prevProps.album === nextProps.album &&
    prevProps.index === nextProps.index &&
    prevProps.isStacked === nextProps.isStacked &&
    prevProps.size === nextProps.size &&
    prevProps.stackOffset === nextProps.stackOffset &&
    prevProps.song?.name === nextProps.song?.name &&
    prevProps.song?.artist === nextProps.song?.artist &&
    prevProps.song?.isRoundWinner === nextProps.song?.isRoundWinner &&
    prevProps.song?.round === nextProps.song?.round
  );
});

export default AlbumThumbnailWithHover;