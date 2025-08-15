
/**
 * PlayerBox component displays a single player's information in the game lobby.
 * Shows the player's name and ready status with appropriate styling.
 * 
 * @param {Object} props - Component props
 * @param {Object} props.player - Player object containing name and status
 * @param {string} props.player.name - Player's name
 * @param {boolean} props.player.isHost - Whether the player is the game host
 * @param {boolean} props.player.isReady - Whether the player is ready to start
 * @returns {JSX.Element} Rendered component
 */
export default function PlayerBox({ player }) {
  return (
    <div className="lobby-player rounded-md">
      {/* Player name with host indicator */}
      <p className={player.isHost ? "font-bold" : ""}>{player.name}</p>
      
      {/* Ready status */}
      <p className={player.isReady ? "ready" : "not-ready"}>
        {player.isReady ? "Ready" : "Not Ready"}
      </p>
    </div>
  );
}
