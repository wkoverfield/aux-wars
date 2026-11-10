import { useEffect } from "react";

const ICONS = {
  share: "M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15",
  copy: "M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244",
  qr: "M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z",
  tv: "M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125Z",
};

/**
 * The lobby's invite options in one place: a sheet from the bottom on a
 * phone, a small dialog on a wider screen. Each option closes the sheet and
 * runs its handler. Options whose handler is missing are not shown.
 *
 * @param {Object} props
 * @param {Function} props.onClose - Closes the sheet
 * @param {Function} [props.onShare] - System share sheet (touch devices that have one)
 * @param {Function} props.onCopyLink - Copies the invite link
 * @param {Function} [props.onShowQr] - Shows the QR code (hidden while streaming)
 * @param {Function} [props.onLocalPlay] - Turns on Local Play (host, private room, while off)
 */
export default function InviteSheet({ onClose, onShare, onCopyLink, onShowQr, onLocalPlay }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options = [
    onShare && { key: "share", label: "Share invite link", icon: ICONS.share, run: onShare },
    { key: "copy", label: "Copy invite link", icon: ICONS.copy, run: onCopyLink },
    onShowQr && { key: "qr", label: "Show QR code", hint: "Friends in the room scan it to join", icon: ICONS.qr, run: onShowQr },
    onLocalPlay && { key: "tv", label: "Play on a TV", hint: "One screen plays the music, phones vote", icon: ICONS.tv, run: onLocalPlay },
  ].filter(Boolean);

  return (
    <div
      data-vital="invite-sheet"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-sheet-title"
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-lg bg-[#242424] p-4 pb-6 sm:p-5 text-white flex flex-col gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="invite-sheet-title" className="text-lg font-semibold px-2 pb-2">Invite friends</h2>
        {options.map((o, i) => (
          <button
            key={o.key}
            type="button"
            data-vital={`invite-${o.key}`}
            autoFocus={i === 0}
            onClick={() => {
              onClose();
              o.run();
            }}
            className="flex items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-white/5 focus-visible:bg-white/5 outline-none transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 shrink-0 text-gray-300" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={o.icon} />
            </svg>
            <span className="flex flex-col">
              <span className="text-sm">{o.label}</span>
              {o.hint && <span className="text-xs text-gray-400">{o.hint}</span>}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full py-3 rounded-md font-semibold bg-[#414141] hover:bg-[#4d4d4d] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
