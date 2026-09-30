import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import AppDisplay from "./components/AppDisplay";
import PageTransition from "./components/PageTransition";
import Home from "./features/lobby/Home";
import Lobby from "./features/lobby/Lobby";
import Round from "./features/round/Round";
import RoundWinner from "./features/round-winner/RoundWinner";
import GameWinner from "./features/round-winner/GameWinner";
import GameRouteGuard from "./components/GameRouteGuard";
import NavigationBlocker from "./components/NavigationBlocker";
import ConnectionStatus from "./components/ConnectionStatus";
import PageviewTracker from "./components/PageviewTracker";
import CookieConsent from "./components/CookieConsent";
import PrivacyPolicy from "./features/legal/PrivacyPolicy";
import ProSuccess from "./features/legal/ProSuccess";
import ProRestore from "./features/legal/ProRestore";
import { ToastProvider } from "./contexts/ToastContext";
import { RoomProvider } from "./services/RoomProvider";
import ErrorBoundary from "./components/ErrorBoundary";

// Private admin dashboard: lazy so its code never ships in the main bundle.
const StatsPage = lazy(() => import("./features/stats/StatsPage"));

function isStatsPath(pathname) {
  return pathname === "/stats" || pathname.startsWith("/stats/");
}

/** Site pageview counting, skipped on /stats so admin visits are not counted as players. */
function SitePageviews() {
  const { pathname } = useLocation();
  return isStatsPath(pathname) ? null : <PageviewTracker />;
}

function StatsRoute() {
  return (
    <Suspense fallback={<div className="min-h-svh w-full bg-[#121212]" />}>
      <StatsPage />
    </Suspense>
  );
}

function RoomProviderOutlet() {
  return (
    <RoomProvider>
      <Outlet />
    </RoomProvider>
  );
}

/**
 * App component serves as the root component of the application.
 * Sets up routing, game state management, and socket connection.
 * 
 * @returns {JSX.Element} Rendered component
 */
export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <ToastProvider>
          <NavigationBlocker />
          <SitePageviews />
          <ConnectionStatus />
          <CookieConsent />
          <Routes>
              <Route path="/stats" element={<StatsRoute />} />
              <Route path="/" element={<AppDisplay />}>
                <Route index element={<PageTransition><Home /></PageTransition>} />
                <Route path="privacy" element={<PageTransition><PrivacyPolicy /></PageTransition>} />
                <Route path="pro/success" element={<PageTransition><ProSuccess /></PageTransition>} />
                <Route path="pro/restore" element={<PageTransition><ProRestore /></PageTransition>} />
                <Route path="/lobby" element={<Navigate to="/" replace />} />
                <Route path="/lobby/:gameCode" element={<GameRouteGuard />}>
                  <Route element={<RoomProviderOutlet />}>
                    <Route index element={<PageTransition><Lobby /></PageTransition>} />
                    <Route path="round" element={<PageTransition><Round /></PageTransition>} />
                    <Route path="results" element={<PageTransition><RoundWinner /></PageTransition>} />
                    <Route path="gamewinner" element={<PageTransition><GameWinner /></PageTransition>} />
                  </Route>
                </Route>
              </Route>
          </Routes>
        </ToastProvider>
      </Router>
    </ErrorBoundary>
  );
}
