import { useEffect, useState } from "react";

/**
 * A QR code for the room's invite link, for friends in the same room: they
 * point a phone camera at it and land on the join screen. The QR library is
 * loaded only when this opens.
 *
 * @param {Object} props
 * @param {string} props.url - The invite link to encode
 * @param {Function} props.onClose - Closes the modal
 */
export default function InviteQrModal({ url, onClose }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((qr) => qr.toDataURL(url, { margin: 2, width: 512, errorCorrectionLevel: "M" }))
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-vital="invite-qr"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-qr-title"
        className="w-full max-w-sm rounded-lg bg-[#242424] p-6 text-white flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="invite-qr-title" className="text-2xl">Scan to join</h2>
        <p className="text-sm text-gray-300 text-center">
          Point a phone camera at the code. It opens this game, ready to join.
        </p>
        <div className="w-64 h-64 max-w-full rounded-md bg-white flex items-center justify-center">
          {src ? (
            <img src={src} alt="QR code for this game's invite link" width={256} height={256} className="w-full h-full rounded-md" />
          ) : failed ? (
            <p className="text-sm text-black text-center px-4">Couldn&apos;t make the code. Use the invite link instead.</p>
          ) : (
            <span role="status" className="h-8 w-8 rounded-full border-2 border-[#242424] border-t-transparent animate-spin">
              <span className="sr-only">Making the code...</span>
            </span>
          )}
        </div>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="w-full py-3 rounded-md font-semibold bg-[#414141] hover:bg-[#4d4d4d] transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
