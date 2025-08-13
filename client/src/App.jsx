import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import AppDisplay from "./components/AppDisplay";
import Home from "./features/lobby/Home";
import { SocketProvider } from "./services/SocketProvider";
import Lobby from "./features/lobby/Lobby";
import { GameProvider } from "./services/GameContext";
import Round from "./features/round/Round";
import RoundWinner from "./features/round-winner/RoundWinner";
import GameWinner from "./features/round-winner/GameWinner";

/**
 * App component serves as the root component of the application.
 * Sets up routing, game state management, and socket connection.
 * 
 * @returns {JSX.Element} Rendered component
 */
export default function App() {
  return (
    <Router>
      <GameProvider>
        <SocketProvider>
          <Routes>
            <Route path="/" element={<AppDisplay />}>
              <Route index element={<Home />} />
              <Route path="/lobby/:gameCode" element={<Lobby />} />
              <Route path="lobby/:gameCode/round" element={<Round />} />
              <Route path="lobby/:gameCode/results" element={<RoundWinner />} />
              <Route path="lobby/:gameCode/gamewinner" element={<GameWinner />} />
            </Route>
          </Routes>
        </SocketProvider>
      </GameProvider>
    </Router>
  );
}
