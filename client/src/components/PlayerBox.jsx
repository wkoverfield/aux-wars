import { memo } from 'react';
import kickIcon from '../assets/kick-icon.svg';

/**
 * One player row in the game lobby: name, host weight, ready status, and a
 * kick button when the viewer may kick this player.
 *
 * Props are primitives (plus a stable onKick) so React.memo skips rows whose
 * player did not change when the players query re-delivers new objects.
 *
 * @param {Object} props - Component props
 * @param {string} props.playerId - Player's id (passed to onKick)
 * @param {string} props.name - Player's name
 * @param {boolean} props.isPlayerHost - Whether this player hosts the game
 * @param {boolean} props.isReady - Whether this player is ready
 * @param {boolean} props.canKick - Whether the viewer may kick this player
 * @param {Function} [props.onKick] - Called with playerId after confirmation
 * @returns {JSX.Element} Rendered component
 */
function PlayerBox({ playerId, name, isPlayerHost, isReady, canKick, onKick }) {
  const handleKickClick = () => {
    const confirmed = window.confirm(`Are you sure you want to kick ${name}?`);
    if (confirmed) {
      onKick(playerId);
    }
  };

  return (
    <div className="lobby-player rounded-md">
      {/* Player name with host indicator */}
      <p className={isPlayerHost ? "font-bold" : ""}>{name}</p>

      <div className="flex items-center gap-3">
        {/* Ready status */}
        <p className={isReady ? "ready" : "not-ready"}>
          {isReady ? "Ready" : "Not Ready"}
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

export default memo(PlayerBox);
