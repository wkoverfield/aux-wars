import PlayerBox from "./PlayerBox";

/**
 * PlayerList component displays a scrollable list of players in the game lobby.
 *
 * @param {Object} props - Component props
 * @param {Array<Object>} props.players - Array of player objects to display
 * @param {boolean} props.isHost - Whether the current user is the host
 * @param {string} props.currentPlayerId - Current user's player ID
 * @param {Function} props.onKick - Callback function to kick player
 * @returns {JSX.Element} Rendered component
 */
export default function PlayerList({ players, isHost, currentPlayerId, onKick }) {
  return (
    <div
      className="lobby-players flex flex-col w-full items-center gap-2 pb-8"
    >
      {players.map((player) => (
        <PlayerBox
          key={player.playerId || player._id}
          player={player}
          isHost={isHost}
          currentPlayerId={currentPlayerId}
          onKick={onKick}
        />
      ))}
    </div>
  );
}
