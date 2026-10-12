import PlayerResultWithHover from '../../components/PlayerResultWithHover';

/**
 * A finished game's standings: the winner, everyone else, and the game's
 * awards as a quiet list. Used by the final screen and the shared results
 * page, so both read the same.
 *
 * @param {Object} props
 * @param {Array} props.players - Players best first (see standingsFrom)
 * @param {Array} props.awards - The game's awards (see pickReel)
 * @param {Function} props.onPickPlayer - Called with a player to open their setlist
 */
export default function Standings({ players, awards = [], onPickPlayer }) {
  const [winner, ...rest] = players;
  const seat = 'w-full flex cursor-pointer bg-transparent border-0 p-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#68d570]/60';
  return (
    <>
      {winner && (
        <button
          type="button"
          aria-label={`View ${winner.playerName}'s setlist`}
          className={`${seat} flex-col items-center mt-2`}
          onClick={() => onPickPlayer(winner)}
        >
          <div className="text-3xl mb-1">👑</div>
          <PlayerResultWithHover
            playerName={winner.playerName} songs={winner.songs}
            wins={winner.wins} totalRecords={winner.totalRecords} isWinner
          />
        </button>
      )}

      <div className="w-full flex flex-col items-center gap-2 mt-2">
        {rest.map((player) => (
          <button
            type="button"
            key={player.playerId}
            aria-label={`View ${player.playerName}'s setlist`}
            className={`${seat} justify-center`}
            onClick={() => onPickPlayer(player)}
          >
            <PlayerResultWithHover
              playerName={player.playerName} songs={player.songs}
              wins={player.wins} totalRecords={player.totalRecords} isWinner={false}
            />
          </button>
        ))}
      </div>

      {/* The awards from the reveal, kept on the page once it has played. */}
      {awards.length > 0 && (
        <ul aria-label="Awards" className="w-full max-w-md mt-4 px-3 space-y-1.5">
          {awards.map((award) => (
            <li key={award.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-white/50 truncate">
                <span aria-hidden="true">{award.emoji}</span> {award.title}
              </span>
              <span className="text-white/80 truncate">{award.playerName}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
