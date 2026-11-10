import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';

// The first page the app renders (and every prerendered page) shows without a
// fade, so static HTML is visible before JS runs. Later route changes fade in.
let firstRender = true;

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
  const skipFade = firstRender || typeof window === 'undefined';
  useEffect(() => {
    firstRender = false;
  }, []);

  return (
    <motion.div
      key={location.pathname}
      initial={skipFade ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="w-full h-full"
    >
      {children}
    </motion.div>
  );
}
