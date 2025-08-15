import { motion } from "framer-motion";

/**
 * HomeBtn component is a reusable button with hover animation and optional icon.
 * Uses Framer Motion for smooth animations.
 * 
 * @param {Object} props - Component props
 * @param {string} [props.className=""] - Additional CSS classes to apply
 * @param {string} props.text - Button text to display
 * @param {string} [props.icon] - Optional icon URL to display
 * @param {Function} props.onClick - Callback when button is clicked
 * @param {string} [props.padding="py-4"] - Padding classes to apply
 * @returns {JSX.Element} Rendered component
 */
export default function HomeBtn({
  className = "",
  text,
  icon,
  onClick,
  padding = "py-4",
}) {
  return (
    <motion.button
      initial={{ scale: 1 }}
      whileHover={{ scale: 1.05 }}
      transition={{ type: "spring", stiffness: 300, damping: 15 }}
      onClick={onClick}
      className={`${className} rounded-full ${padding} flex items-center gap-2 justify-center`}
    >
      {/* Optional icon */}
      {icon && <img src={icon} alt="Button Icon" className="w-5 md:w-8" />}
      
      {/* Button text */}
      <span className="text-sm md:text-base font-semibold">{text}</span>
    </motion.button>
  );
}
