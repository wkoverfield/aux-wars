import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from "react-router-dom";
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
import { ToastProvider } from "./contexts/ToastContext";
import { RoomProvider } from "./services/RoomProvider";
import ErrorBoundary from "./components/ErrorBoundary";

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
          <ConnectionStatus />
          <Routes>
              <Route path="/" element={<AppDisplay />}>
                <Route index element={<PageTransition><Home /></PageTransition>} />
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
