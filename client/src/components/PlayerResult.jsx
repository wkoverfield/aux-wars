import recordLogo from './record-logo.svg';

/**
 * PlayerResult component displays a player's game results with their album covers.
 * Can be rendered in two different layouts: winner (vertical) or non-winner (horizontal).
 * 
 * @param {Object} props - Component props
 * @param {string} props.playerName - Name of the player
 * @param {string[]} props.albums - Array of album cover URLs
 * @param {number} props.wins - Number of wins
 * @param {number} props.totalRecords - Total number of records earned
 * @param {boolean} [props.isWinner=false] - Whether this player is the winner
 * @returns {JSX.Element} Rendered component
 */
export default function PlayerResult({ playerName, albums, wins, totalRecords, isWinner = false }) {
  const isStack = albums && albums.length > 1;

  if (isWinner) {
    // Winner: large vertical layout
    return (
      <div className="flex flex-col items-center text-center w-full max-w-md mx-auto mb-8 p-4">
        <div className="relative flex flex-row justify-center items-center mb-4 h-24">
          {isStack ? (
            albums.slice(0, 5).map((album, idx) => (
              <img
                key={idx}
                src={album}
                alt="Album Cover"
                className="w-20 h-20 sm:w-28 sm:h-28 rounded-lg shadow-lg absolute"
                style={{
                  left: `${idx * 36}px`,
                  zIndex: 10 - idx,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                }}
              />
            ))
          ) : (
            <img
              src={albums[0]}
              alt="Album Cover"
              className="w-28 h-28 rounded-lg shadow-lg"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
            />
          )}
          {/* Container width for offset stack */}
          {isStack && <div style={{ width: `${Math.min(albums?.length || 1, 5) * 36 + 56}px`, height: '112px' }}></div>}
        </div>
        <div className="text-center w-full mt-2">
          <h3 className="text-2xl sm:text-3xl font-bold m-0 text-[#68d570]">{playerName}</h3>
          <div className="flex flex-row justify-center items-center gap-4 mt-2">
            <span className="text-lg sm:text-xl font-semibold text-white">{wins} Win{wins !== 1 ? 's' : ''}</span>
            <span className="flex items-center gap-1 text-gray-300 text-lg sm:text-xl font-semibold">
              <img src={recordLogo} alt="Record" className="w-7 h-7 inline-block" />
              {totalRecords}
            </span>
          </div>
        </div>
      </div>
    );
  } else {
    // Non-winner: row layout
    return (
      <div className="flex items-center justify-between w-[95%] max-w-[580px] mx-auto my-4 p-3 rounded-lg text-white">
        <div className="relative flex flex-row items-center h-16 w-24 min-w-[72px]">
          {isStack ? (
            albums.slice(0, 5).map((album, idx) => (
              <img
                key={idx}
                src={album}
                alt="Album Cover"
                className="w-12 h-12 sm:w-16 sm:h-16 rounded-md shadow-md absolute"
                style={{
                  left: `${idx * 18}px`,
                  zIndex: 10 - idx,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                }}
              />
            ))
          ) : (
            <img
              src={albums[0]}
              alt="Album Cover"
              className="w-16 h-16 rounded-md shadow-md"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
            />
          )}
          {isStack && <div style={{ width: `${(albums?.length || 1) * 18 + 48}px`, height: '64px' }}></div>}
        </div>
        <div className="flex-1 overflow-hidden flex flex-col justify-center">
          <h3 className="text-xl font-bold m-0 text-white truncate">{playerName}</h3>
          <div className="flex flex-row items-center gap-3 mt-1">
            <span className="text-base text-white font-semibold">{wins} Win{wins !== 1 ? 's' : ''}</span>
            <span className="flex items-center gap-1 text-gray-300 text-base font-semibold">
              <img src={recordLogo} alt="Record" className="w-5 h-5 inline-block" />
              {totalRecords}
            </span>
          </div>
        </div>
      </div>
    );
  }
}
