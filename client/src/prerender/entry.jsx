import { renderToString } from 'react-dom/server';
import { Route, Routes, StaticRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import AppDisplay from '../components/AppDisplay';
import PageTransition from '../components/PageTransition';
import Home from '../features/lobby/Home';
import Faq from '../features/legal/Faq';
import AuxBattle from '../features/legal/AuxBattle';
import PrivacyPolicy from '../features/legal/PrivacyPolicy';
import NotFound from '../features/legal/NotFound';
import { ToastProvider } from '../contexts/ToastContext';

/**
 * Build-time entry: renders the static pages listed in data/pages.js to HTML
 * with the same layout and route wrappers as App.jsx, so the markup in #root
 * matches the app's first render. The prerender plugin in vite.config.js
 * builds this for Node with convex/react swapped for ./convexStub.js
 * (queries read as loading, mutations never run).
 */
const ELEMENTS = {
  '/': <Home />,
  '/faq': <Faq />,
  '/aux-battle': <AuxBattle />,
  '/privacy': <PrivacyPolicy />,
  '/404': <NotFound />,
};

export function render(path) {
  const element = ELEMENTS[path];
  if (!element) throw new Error(`prerender: no element for ${path}`);
  return renderToString(
    <MotionConfig reducedMotion="user">
      <StaticRouter location={path}>
        <ToastProvider>
          <Routes>
            <Route element={<AppDisplay />}>
              <Route path="*" element={<PageTransition>{element}</PageTransition>} />
            </Route>
          </Routes>
        </ToastProvider>
      </StaticRouter>
    </MotionConfig>,
  );
}
