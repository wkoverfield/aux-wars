import { useEffect } from "react";
import { screenUrl, screenUrlLabel } from "../screen/screenModel";

/**
 * The room's big-screen address, large enough to read off a phone and type
 * into a TV or laptop browser, with a copy action.
 *
 * @param {Object} props
 * @param {string} props.code - Room code
 * @param {Function} props.onCopy - Copies the full screen URL
 * @param {Function} props.onClose - Closes the modal
 */
export default function ScreenLinkModal({ code, onCopy, onClose }) {
  const label = screenUrlLabel(code);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-vital="screen-link"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-link-title"
        className="w-full max-w-sm rounded-lg bg-[#242424] p-6 text-white flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="screen-link-title" className="text-2xl">Show on a big screen</h2>
        <p className="text-sm text-gray-300 text-center">
          Open this on a TV or laptop. The songs play from there, and everyone keeps playing on their phone.
        </p>
        <a
          href={screenUrl(code)}
          target="_blank"
          rel="noopener"
          className="w-full rounded-md bg-[#121212] px-4 py-5 text-center text-xl font-semibold hover:text-[#68d570] transition-colors"
        >
          {/* Wraps only before the path, never inside the code. */}
          {label.slice(0, label.indexOf("/screen/"))}
          <wbr />
          <span className="whitespace-nowrap">{label.slice(label.indexOf("/screen/"))}</span>
        </a>
        <div className="w-full flex gap-3">
          <button
            type="button"
            onClick={onCopy}
            className="flex-1 py-3 rounded-md font-semibold bg-[#414141] hover:bg-[#4d4d4d] transition-colors"
          >
            Copy link
          </button>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="flex-1 py-3 rounded-md font-semibold bg-[#414141] hover:bg-[#4d4d4d] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
