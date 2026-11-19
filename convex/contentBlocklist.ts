/**
 * Word list that keeps a song or artist off the public content pages.
 *
 * Holds slurs and explicit sexual terms. Ordinary profanity is not listed.
 * Matching is whole-word on the output of clean() (songStats.ts), so a listed
 * word inside a longer word never matches ("Scunthorpe", "cocktail",
 * "analog"). A multi-word entry matches as a phrase.
 */
import { clean } from "./songStats";

export const BLOCKED_TERMS: string[] = [
  // Slurs
  "nigger", "niggers", "nigga", "niggas", "niggaz", "sandnigger",
  "faggot", "faggots", "fag", "fags", "tranny", "trannies",
  "retard", "retards", "chink", "chinks", "spic", "spics",
  "kike", "kikes", "gook", "gooks", "coon", "coons",
  "beaner", "beaners", "wetback", "wetbacks",
  "raghead", "ragheads", "towelhead", "towelheads", "paki", "pakis",
  // Sexual terms
  "sex", "porn", "porno", "pornography", "pornhub", "xxx", "hentai",
  "cum", "cumshot", "creampie", "bukkake", "gangbang",
  "blowjob", "blowjobs", "handjob", "rimjob", "deepthroat", "fellatio",
  "dildo", "dildos", "anal", "orgasm", "orgasms",
  "masturbate", "masturbation", "jerk off", "jack off",
  "pussy", "pussies", "cunt", "cunts", "cock", "cocks", "dick", "dicks",
  "penis", "vagina", "tits", "titties", "nude", "nudes",
  "slut", "sluts", "whore", "whores", "milf", "horny", "erotic",
  "incest", "rape", "raped", "rapist", "molest", "pedo", "pedophile",
];

const BLOCKED = BLOCKED_TERMS.map((term) => ` ${clean(term)} `);

/** True when the text holds a listed term as a whole word or phrase. */
export function isBlocked(text: string): boolean {
  const cleaned = clean(text);
  if (!cleaned) return false;
  const padded = ` ${cleaned} `;
  return BLOCKED.some((term) => padded.includes(term));
}
