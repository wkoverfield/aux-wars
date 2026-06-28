/**
 * Hate-speech blocklist for user-visible text (player names, custom prompts).
 *
 * Blocks SLURS ONLY — NOT general profanity. Aux Wars is intentionally edgy
 * (the "unhinged" pack), so cussing stays; this only stops the stuff that would
 * tank a streamer (or anyone): targeted slurs on screen. Server-side so it can't
 * be bypassed by reading the public repo.
 *
 * Matching: normalize leetspeak + collapse repeated characters, then match each
 * slur on word boundaries (bounded by start/end or a non-letter). Boundaries are
 * what keep legit words safe — "Scunthorpe", "raccoon", "Pakistani", "despicable"
 * contain a slur as a *substring* but never as a *token*, so they don't trip.
 * Known v1 gap: space-separated evasion ("n i g g a") isn't caught — tightening
 * that risks false positives, so it's deferred.
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/3/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/7/g, "t")
    .replace(/(.)\1+/g, "$1"); // collapse runs: "niggga" -> "niga", "xX" -> "x"
}

// Unambiguous slurs (racial, homophobic/transphobic, antisemitic, ethnic, ableist).
// Stored normalized so the same rules apply to input and patterns.
const SLUR_ROOTS = [
  "nigger", "nigga", "sandnigger", "faggot", "fag", "tranny", "retard",
  "chink", "spic", "kike", "gook", "coon", "beaner", "wetback",
  "raghead", "towelhead", "paki",
].map(normalize);

/** True if the text contains a slur as a standalone token. */
export function containsHateSpeech(text: string): boolean {
  if (!text) return false;
  const n = normalize(text);
  return SLUR_ROOTS.some((root) => new RegExp(`(^|[^a-z])${root}([^a-z]|$)`).test(n));
}
