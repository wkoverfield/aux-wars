import logo from "../assets/landing-logo.svg";
import { motion } from "framer-motion";

/**
 * AnimatedLogo component displays the Aux Wars logo with a continuous pulse animation.
 * Uses Framer Motion for smooth scaling animation.
 * 
 * @returns {JSX.Element} Rendered component
 */
export default function AnimatedLogo() {
  // Define the pulse animation configuration
  const pulseAnimation = {
    scale: [1, 1.05, 1],
    transition: {
      duration: 3,
      repeat: Infinity,
      ease: "easeInOut",
    },
  };

  return (
    <motion.img
      data-testid="animated-logo"
      className="landing-logo p-6 md:p-12 w-64 h-32 md:w-auto md:h-auto object-contain"
      src={logo}
      alt="Aux Wars Logo"
      animate={pulseAnimation}
    />
  );
}
