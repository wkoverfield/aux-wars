import kickIcon from '../assets/kick-icon.svg';

/**
 * PlayerBox component displays a single player's information in the game lobby.
 * Shows the player's name and ready status with appropriate styling.
 * If viewing player is the host, shows kick button for other players.
 *
 * @param {Object} props - Component props
 * @param {Object} props.player - Player object containing name and status
 * @param {string} props.player.name - Player's name
 * @param {boolean} props.player.isHost - Whether the player is the game host
 * @param {boolean} props.player.isReady - Whether the player is ready to start
 * @param {boolean} props.isHost - Whether the current user is the host
 * @param {string} props.currentPlayerId - Current user's player ID
 * @param {Function} props.onKick - Callback function to kick player
 * @returns {JSX.Element} Rendered component
 */
export default function PlayerBox({ player, isHost, currentPlayerId, onKick }) {
  const isCurrentPlayer = player.playerId === currentPlayerId;
  const canKick = isHost && !isCurrentPlayer && !player.isHost && onKick;

  const handleKickClick = () => {
    const confirmed = window.confirm(`Are you sure you want to kick ${player.name}?`);
    if (confirmed) {
      onKick(player.playerId);
    }
  };

  return (
    <div className="lobby-player rounded-md">
      {/* Player name with host indicator */}
      <p className={player.isHost ? "font-bold" : ""}>{player.name}</p>

      <div className="flex items-center gap-3">
        {/* Ready status */}
        <p className={player.isReady ? "ready" : "not-ready"}>
          {player.isReady ? "Ready" : "Not Ready"}
        </p>

        {/* Kick button (only for host, only for other players) */}
        {canKick && (
          <button
            onClick={handleKickClick}
            className="text-red-500 hover:text-red-700 p-1 transition-transform hover:scale-110"
            title="Kick player"
          >
            <img src={kickIcon} alt="Kick" className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
