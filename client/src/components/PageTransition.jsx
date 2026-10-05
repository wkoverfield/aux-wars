import { motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';

/**
 * Fades each page in on route change. Opacity only (no transforms, no exit
 * animation), so the outgoing page unmounts immediately and its cleanup
 * effects, such as the rating auto-submit, run without delay.
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Page content
 * @returns {JSX.Element} Fading page wrapper
 */
export default function PageTransition({ children }) {
  const location = useLocation();

  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="w-full h-full"
    >
      {children}
    </motion.div>
  );
}
