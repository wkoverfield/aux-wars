
/**
 * WaitingScreen component displays a loading state while waiting for other players
 * to complete their actions in the game.
 * 
 * @param {Object} props - Component props
 * @param {number} props.completedCount - Number of players who have completed their action
 * @param {number} props.totalCount - Total number of players in the game
 * @param {string} [props.message] - Optional custom message to display
 * @returns {JSX.Element} Rendered component
 */
export default function WaitingScreen({ completedCount, totalCount, message }) {
  const defaultMessage = "Your song has been submitted! Hang tight while everyone else makes their selection.";
  
  // Create array of player indicators
  const playerIndicators = Array.from({ length: totalCount || 0 }, (_, i) => i < completedCount);
  
  return (
    <div className="waiting-screen flex flex-col items-center justify-center min-h-[80vh] w-full px-4">
      <div className="text-center p-4 md:p-8 max-w-md">
        <h2 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6 text-white">
          Waiting for other players
        </h2>
        
        {completedCount !== undefined && totalCount !== undefined && (
          <>
            <p className="text-lg md:text-xl text-white mb-6">
              {completedCount} of {totalCount} players have submitted
            </p>
            
            {/* Player submission indicators */}
            <div className="flex justify-center gap-3 mb-8">
              {playerIndicators.map((isCompleted, index) => (
                <div
                  key={index}
                  className={`h-3 w-3 rounded-full transition-all duration-300 ${
                    isCompleted
                      ? 'bg-green-500 scale-110'
                      : 'bg-[#242424] scale-100'
                  }`}
                />
              ))}
            </div>
          </>
        )}
        
        {/* Centered loading spinner */}
        <div className="flex justify-center mb-8">
          <div className="relative">
            <div className="h-12 w-12 md:h-16 md:w-16 rounded-full border-4 border-[#242424]"></div>
            <div className="absolute top-0 h-12 w-12 md:h-16 md:w-16 rounded-full border-4 border-green-500 border-t-transparent animate-spin"></div>
          </div>
        </div>
        
        <p className="text-white text-sm md:text-base">
          {message || defaultMessage}
        </p>
      </div>
    </div>
  );
} 