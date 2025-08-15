import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import AppDisplay from "./components/AppDisplay";
import PageTransition from "./components/PageTransition";
import Home from "./features/lobby/Home";
import { SocketProvider } from "./services/SocketProvider";
import Lobby from "./features/lobby/Lobby";
import { GameProvider } from "./services/GameContext";
import Round from "./features/round/Round";
import RoundWinner from "./features/round-winner/RoundWinner";
import GameWinner from "./features/round-winner/GameWinner";
import GameRouteGuard from "./components/GameRouteGuard";
import NavigationBlocker from "./components/NavigationBlocker";
import ConnectionStatus from "./components/ConnectionStatus";
import { ToastProvider } from "./contexts/ToastContext";

/**
 * App component serves as the root component of the application.
 * Sets up routing, game state management, and socket connection.
 * 
 * @returns {JSX.Element} Rendered component
 */
export default function App() {
  return (
    <Router>
      <ToastProvider>
        <GameProvider>
          <SocketProvider>
            <NavigationBlocker />
            <ConnectionStatus />
            <Routes>
              <Route path="/" element={<AppDisplay />}>
                <Route index element={<PageTransition><Home /></PageTransition>} />
                <Route path="/lobby" element={<Navigate to="/" replace />} />
                <Route path="/lobby/:gameCode" element={<GameRouteGuard />}>
                  <Route index element={<PageTransition><Lobby /></PageTransition>} />
                  <Route path="round" element={<PageTransition><Round /></PageTransition>} />
                  <Route path="results" element={<PageTransition><RoundWinner /></PageTransition>} />
                  <Route path="gamewinner" element={<PageTransition><GameWinner /></PageTransition>} />
                </Route>
              </Route>
            </Routes>
          </SocketProvider>
        </GameProvider>
      </ToastProvider>
    </Router>
  );
}
