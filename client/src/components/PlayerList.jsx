import PlayerBox from "./PlayerBox";

/**
 * PlayerList component displays a scrollable list of players in the game lobby.
 * 
 * @param {Object} props - Component props
 * @param {Array<Object>} props.players - Array of player objects to display
 * @returns {JSX.Element} Rendered component
 */
export default function PlayerList({ players }) {
  return (
    <div
      className="lobby-players flex flex-col w-full items-center gap-2 pb-8 overflow-y-auto flex-1 min-h-0"
    >
      {players.map((player, index) => (
        <PlayerBox key={index} player={player} />
      ))}
    </div>
  );
}
