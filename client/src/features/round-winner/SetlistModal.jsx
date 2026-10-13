import { motion } from 'framer-motion';
import ScrollFade from '../../components/ScrollFade';
import recordLogo from '../../components/record-logo.svg';

/** Per-player setlist modal — their picks across the game with scores. */
export default function SetlistModal({ player, onClose }) {
  if (!player) return null;
  const songs = [...(player.songs || [])].sort((a, b) => a.round - b.round);
  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
    >
      <motion.div
        className="bg-[#181818] rounded-lg w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-5 pb-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Setlist</p>
            <h3 className="text-xl font-bold text-[#68d570]">{player.playerName}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none px-2">×</button>
        </div>
        <ScrollFade className="flex-1 min-h-0" contentClassName="px-5 pb-5 space-y-2" fadeColor="#181818" showTop={false}>
          {songs.length === 0 && <p className="text-sm text-gray-400 py-2">No songs submitted this game.</p>}
          {songs.map((s) => (
            <div key={`${s.round}-${s.songId}`} className="flex items-center gap-2.5 p-2 rounded-md bg-[#242424]">
              <span className="text-[11px] text-gray-500 w-5 shrink-0 text-center">R{s.round}</span>
              <img src={s.albumCover} alt="" className="w-11 h-11 rounded object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">{s.name}{s.isRoundWinner ? ' 🏆' : ''}</p>
                <p className="text-xs text-gray-400 truncate">{s.artist}</p>
                {s.prompt && (
                  <p className="text-[11px] text-gray-500 truncate italic mt-0.5">“{s.prompt}”</p>
                )}
              </div>
              <span className="flex items-center gap-1 text-sm font-semibold text-gray-200 shrink-0">
                <img src={recordLogo} alt="records" className="w-4 h-4" />
                {s.totalRecords}
              </span>
            </div>
          ))}
        </ScrollFade>
      </motion.div>
    </motion.div>
  );
}
