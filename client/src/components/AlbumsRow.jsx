import { motion } from "framer-motion";

/**
 * AlbumRow component displays a row of album covers with continuous horizontal animation.
 * Uses Framer Motion for smooth infinite scrolling effect.
 * 
 * @param {Object} props - Component props
 * @param {Array<string>} props.albums - Array of album cover image URLs
 * @param {string} props.direction - Animation direction ('left' or 'right')
 * @returns {JSX.Element} Rendered component
 */
export default function AlbumRow({ albums, direction }) {
    // Set animation direction based on prop
    const animateX = direction === "left" ? ["5%", "-40%"] : ["-40%", "5%"];

  return (
    <motion.div
      animate={{ x: animateX }}
      transition={{
        duration: 100,
        ease: "linear",
        repeat: Infinity,
        repeatType: "reverse",
      }}
    >
      <div className="album-row flex gap-10">
        {albums.map((album, index) => (
          <div key={index} className="album">
            <img src={album} alt="album-cover" />
          </div>
        ))}
      </div>
    </motion.div>
  );
}
