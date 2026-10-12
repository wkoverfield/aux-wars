/** The link that seats a friend in a room: it opens the join screen for `code`. */
export function inviteUrl(code, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return `${origin}/lobby/${code}`;
}

export const INVITE_TITLE = "Aux Wars";
export const INVITE_TEXT = "Join my Aux Wars game. Pick a song for the prompt and we rate each other's picks:";

/**
 * True on a touch-first device (phone, tablet). Desktop browsers also expose
 * navigator.share, but there it opens an OS popover where a copied link is
 * what people want.
 */
export function isTouchDevice(win = typeof window === "undefined" ? undefined : window) {
  return Boolean(win?.matchMedia?.("(pointer: coarse)")?.matches);
}

/**
 * Sends the invite the best way this device can: the system share sheet on
 * a touch device that has one, otherwise the clipboard.
 *
 * Resolves to how it went:
 * - "shared": handed to the share sheet
 * - "copied": link copied to the clipboard
 * - "cancelled": the share sheet was dismissed (not an error, nothing copied)
 * - "failed": neither worked
 */
export async function sendInvite(
  url,
  nav = typeof navigator === "undefined" ? undefined : navigator,
  touch = isTouchDevice()
) {
  if (touch && typeof nav?.share === "function") {
    try {
      await nav.share({ title: INVITE_TITLE, text: INVITE_TEXT, url });
      return "shared";
    } catch (err) {
      // Dismissing the sheet rejects with AbortError: the user chose not to share.
      if (err?.name === "AbortError") return "cancelled";
      // Anything else (blocked, unsupported payload) falls through to copying.
    }
  }
  return (await copyInvite(url, nav)) ? "copied" : "failed";
}

/** Copies the invite link. Resolves to whether it worked. */
export async function copyInvite(url, nav = typeof navigator === "undefined" ? undefined : navigator) {
  try {
    await nav.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
