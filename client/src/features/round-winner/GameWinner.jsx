import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
// GameContext removed - using Convex queries directly
// import { useSocket, useSocketConnection, useGameTransition } from '../../services/SocketProvider';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useSession } from '../../hooks/useSession';
import PlayerResultWithHover from '../../components/PlayerResultWithHover';
import AnimatedLogo from '../../components/AnimatedLogo';
import backIcon from '../../assets/back-icon.svg';

/**
 * GameWinner component displays the final game results showing the winner and all players' stats.
 * Includes animations, navigation controls, and handles game state transitions.
 *
 * @returns {JSX.Element} Rendered component
 */
export default function GameWinner() {
  const { gameCode } = useParams();
  const navigate = useNavigate();
  // const socket = useSocket();
  // const isConnected = useSocketConnection();
  const setGameTransition = () => {};
  const allRoundResultsQuery = useQuery(api.game.flow.getAllRoundResults, gameCode ? { code: gameCode } : 'skip');
  const playersQuery = useQuery(api.game.rooms.getPlayers, gameCode ? { code: gameCode } : 'skip');
  const returnToLobbyMutation = useMutation(api.game.flow.returnToLobby);
  const { updateSession } = useSession();
  const stateAllRoundResults = allRoundResultsQuery;

  // Handle game transition animation
  useEffect(() => {
    setGameTransition(true);
    const timer = setTimeout(() => {
      setGameTransition(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [setGameTransition]);

  // Show loading state while data is loading
  if (!allRoundResultsQuery || !playersQuery) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-white text-xl">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-[#1db954] border-t-transparent rounded-full animate-spin"></div>
            <p>Loading final results...</p>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Builds player statistics from round results including wins, records, and songs.
   * @returns {Array<Object>} Array of player stats objects with the following properties:
   *   - playerId: string - Unique identifier for the player
   *   - playerName: string - Display name of the player
   *   - wins: number - Number of rounds won
   *   - totalRecords: number - Total records earned across all rounds
   *   - songs: Array<Object> - List of songs submitted by the player
   */
  const buildPlayerStats = () => {
    const stats = {};
    const rounds = Array.isArray(allRoundResultsQuery)
      ? allRoundResultsQuery
      : Object.values(stateAllRoundResults || {});
    rounds.forEach((round, roundIdx) => {
      if (!round.songs) return;
      
      const winnerSongId = round.winnerSongId;
      
      round.songs.forEach(song => {
        const playerId = song.player?.id;
        if (!playerId) return;
        
        if (!stats[playerId]) {
          stats[playerId] = {
            playerId,
            playerName: song.player.name,
            wins: 0,
            totalRecords: 0,
            songs: [],
          };
        }
        
        stats[playerId].songs.push({
          ...song,
          round: roundIdx + 1,
          isRoundWinner: song.songId === winnerSongId
        });
        
        stats[playerId].totalRecords += song.totalRecords || 0;
        
        if (song.songId === winnerSongId) {
          stats[playerId].wins += 1;
        }
      });
    });
    return Object.values(stats);
  };

  // Sort players by wins and records
  const sortedPlayers = buildPlayerStats()
    .sort((a, b) => b.wins - a.wins || b.totalRecords - a.totalRecords);

  // Separate winner from other players
  const winner = sortedPlayers[0];
  const rest = sortedPlayers.slice(1);
  

  /**
   * Handles returning to the lobby and resetting game state.
   * Emits a return-to-lobby event to the server and navigates back to the lobby.
   */
  const handleReturnToLobby = async () => {
    setGameTransition(true);
    // Game state reset handled by server mutation (returnToLobby)
    const hostPlayer = playersQuery?.find(p => p.isHost);
    await returnToLobbyMutation({ code: gameCode, playerId: hostPlayer?.playerId });
    updateSession({ lastPhase: 'lobby' });
    navigate(`/lobby/${gameCode}`, { replace: true });
  };

  return (
    <div className="relative flex flex-col h-screen w-full max-w-7xl mx-auto pt-2 pb-6 px-2 md:p-6 bg-transparent items-center overflow-hidden">
      {/* Navigation controls */}
      <div className="w-full flex flex-row justify-start mb-1 mt-2 md:mb-2 md:mt-4">
        <button
          className="flex items-center gap-2 py-1 px-3 md:py-2 md:px-4 rounded-md text-white font-semibold cursor-pointer transition-all bg-[#242424] hover:bg-[#191414] text-sm md:text-base"
          onClick={handleReturnToLobby}
        >
          <img src={backIcon} alt="Back" className="w-4 h-4 md:w-5 md:h-5 pt-0.5" />
          <span>Exit</span>
        </button>
      </div>

      {/* Logo section - smaller on mobile */}
      <div className="flex justify-center w-full mb-2 md:mb-4">
        <AnimatedLogo />
      </div>

      {/* Winner display */}
      {winner && (
        <PlayerResultWithHover
          playerName={winner.playerName}
          songs={winner.songs}
          wins={winner.wins}
          totalRecords={winner.totalRecords}
          isWinner={true}
        />
      )}

      {/* Other players list */}
      <div className="w-full flex-1 flex flex-col items-center gap-2 pb-4 overflow-y-auto" style={{ minHeight: '0' }}>
        {rest.map((player, idx) => (
          <PlayerResultWithHover
            key={player.playerId}
            playerName={player.playerName}
            songs={player.songs}
            wins={player.wins}
            totalRecords={player.totalRecords}
            isWinner={false}
          />
        ))}
      </div>
    </div>
  );
} 