import { motion } from "framer-motion";
import nextIcon from "../assets/next-icon.svg";

/**
 * SongItem component displays a single song with its album cover, name, artist, and album.
 * Includes a select button that appears when the song is selected.
 * Uses Framer Motion for animations.
 * 
 * @param {Object} props - Component props
 * @param {Object} props.track - Track object containing song details
 * @param {boolean} props.selected - Whether this song is currently selected
 * @param {Function} props.onSelect - Callback when the song is clicked
 * @param {Function} props.onSelectSong - Callback when the select button is clicked
 * @returns {JSX.Element} Rendered component
 */
export default function SongItem({ track, selected, onSelect, onSelectSong }) {
  // Get the best available album cover image
  const albumCover =
    track.album?.images?.[1]?.url ||
    track.album?.images?.[0]?.url ||
    null;

  return (
    <motion.div
      initial={{ scale: 1 }}
      whileHover={{ scale: 1.02 }}
      transition={{ type: "spring", stiffness: 300, damping: 15 }}
      className={`song-item flex items-center justify-between p-3 mb-3 rounded-md h-auto ${
        selected ? "bg-[#242424]" : "cursor-pointer"
      }`}
      onClick={() => onSelect(track)}
    >
      {/* Song info section */}
      <div className="flex items-center gap-4 w-full">
        {/* Album cover */}
        {albumCover && (
          <img
            src={albumCover}
            alt={track.name}
            className="w-16 h-16 object-cover rounded-md"
          />
        )}
        
        {/* Track details */}
        <div className="flex flex-col justify-center flex-1 min-w-0">
          <p className="font-semibold truncate">{track.name}</p>
          <p className="text-sm text-gray-300 truncate">
            {track.artists.map((a) => a.name).join(", ")}
          </p>
          <p className="text-xs text-gray-400 truncate">
            {track.album?.name}
          </p>
        </div>

        {/* Select button - only shown when song is selected */}
        {selected && (
          <motion.button
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ type: "spring", stiffness: 300, damping: 15 }}
            className="flex items-center gap-2 green-btn text-black font-semibold py-2 px-4 rounded-md cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onSelectSong(track.id);
            }}
          >
            Select Song
            <img 
              src={nextIcon} 
              alt="Arrow Right" 
              className="w-4 h-4 filter invert pt-0.5"
            />
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}
