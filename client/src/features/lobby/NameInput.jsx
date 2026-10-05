import { useEffect, useRef, useState } from "react";

export const NAME_SAVE_DEBOUNCE_MS = 300;

/**
 * Lobby nickname field. Keeps its own draft state so typing re-renders only
 * this input, saves ~300ms after typing stops and immediately on blur or
 * Enter, and never saves a name equal to the one already on the server.
 *
 * @param {Object} props
 * @param {string | undefined} props.serverName - The player's name on the server (undefined while loading)
 * @param {string} [props.initialName] - Draft to show before the server name loads
 * @param {(name: string) => void} props.onSave - Persists a trimmed, changed, non-empty name
 * @param {(draft: string) => void} [props.onDraftChange] - Reports the current draft (for a ref, not state)
 */
export default function NameInput({ serverName, initialName = "", onSave, onDraftChange }) {
  const [value, setValue] = useState(serverName ?? initialName);
  const touchedRef = useRef(false);
  const lastSentRef = useRef(null);
  const timerRef = useRef(null);
  const serverNameRef = useRef(serverName);
  serverNameRef.current = serverName;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Adopt the server name once it loads, unless the player already typed.
  useEffect(() => {
    if (!touchedRef.current && serverName !== undefined) setValue(serverName);
  }, [serverName]);

  useEffect(() => {
    onDraftChange?.(value);
  }, [value, onDraftChange]);

  const saveNow = (draft) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const trimmed = draft.trim();
    if (!trimmed || trimmed === (serverNameRef.current ?? "").trim()) return;
    // A blur right after the debounced save must not send the same name again.
    if (trimmed === lastSentRef.current) return;
    lastSentRef.current = trimmed;
    onSaveRef.current(trimmed);
  };

  // Clear a pending save on unmount.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleChange = (e) => {
    const next = e.target.value;
    touchedRef.current = true;
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      saveNow(next);
    }, NAME_SAVE_DEBOUNCE_MS);
  };

  return (
    <input
      type="text"
      className="w-full rounded-md"
      placeholder="Enter your nickname"
      aria-label="Nickname"
      maxLength={50}
      value={value}
      onChange={handleChange}
      onBlur={() => saveNow(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") saveNow(value);
      }}
    />
  );
}
