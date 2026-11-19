/**
 * Dev fixture for the published content pages. It writes made-up play counts
 * into songStats, so it runs only on a deployment whose ALLOW_CONTENT_SEED
 * environment variable is "1" and throws everywhere else. Never set that
 * variable on production.
 *
 *   npx convex env set ALLOW_CONTENT_SEED 1
 *   npx convex run contentSeed:seedDevSongStats
 *
 * The first call inserts the fixture rows. Every later call adds one more
 * round of picks and ratings to them, so a weekly job run after it has
 * something to report as movers. Fixture rows carry SEED_SOURCE in `sources`;
 * a song key that already has a row without it is skipped, never overwritten.
 *
 * The fixture gives the weekly job: songs past the ratings bar that
 * MusicBrainz knows (live), two artists past the picks bar, one made-up song
 * past the bar (held, no_match), one past the bar with a blocked word (held,
 * filtered), songs below the bar, and per-prompt rows.
 */
import { internalMutation } from "./_generated/server";
import { CURATED_PROMPTS } from "./game/promptPacks";
import { songKey } from "./songStats";

export const SEED_SOURCE = "seed:dev-content";
export const SEED_ENV_VAR = "ALLOW_CONTENT_SEED";

type Fixture = {
  name: string;
  artist: string;
  picks: number;
  wins: number;
  hist: [number, number, number, number, number]; // counts of 1..5 ratings
  // Picks added by every call after the first.
  gain: number;
  // Share of the picks made under each of the first curated prompts.
  prompts: number[];
};

const FIXTURES: Fixture[] = [
  { name: "Blinding Lights", artist: "The Weeknd", picks: 42, wins: 19, hist: [2, 4, 14, 48, 72], gain: 9, prompts: [14, 9, 6] },
  { name: "Starboy", artist: "The Weeknd", picks: 21, wins: 7, hist: [1, 3, 12, 30, 24], gain: 2, prompts: [5, 0, 8] },
  { name: "Save Your Tears", artist: "The Weeknd", picks: 9, wins: 2, hist: [0, 2, 6, 12, 8], gain: 1, prompts: [3] },
  { name: "Hey Ya!", artist: "OutKast", picks: 38, wins: 21, hist: [1, 2, 8, 36, 81], gain: 4, prompts: [0, 11, 0, 9] },
  { name: "Ms. Jackson", artist: "OutKast", picks: 17, wins: 6, hist: [0, 2, 10, 25, 20], gain: 6, prompts: [0, 4] },
  { name: "September", artist: "Earth, Wind & Fire", picks: 30, wins: 17, hist: [0, 1, 5, 22, 70], gain: 3, prompts: [0, 0, 12] },
  { name: "Levitating", artist: "Dua Lipa", picks: 24, wins: 8, hist: [3, 8, 22, 26, 15], gain: 12, prompts: [7, 5] },
  { name: "Friday", artist: "Rebecca Black", picks: 19, wins: 3, hist: [31, 6, 4, 5, 28], gain: 5, prompts: [0, 0, 0, 0, 10] },
  { name: "Señorita", artist: "Shawn Mendes & Camila Cabello", picks: 16, wins: 4, hist: [4, 9, 20, 17, 8], gain: 0, prompts: [6] },
  { name: "Mr. Brightside", artist: "The Killers", picks: 12, wins: 5, hist: [0, 1, 4, 10, 15], gain: 2, prompts: [0, 3] },
  { name: "Zzyzx Fixture Anthem", artist: "QA Fixture Band", picks: 15, wins: 4, hist: [2, 6, 18, 20, 9], gain: 3, prompts: [4] },
  { name: "Sex on Fire", artist: "Kings of Leon", picks: 14, wins: 5, hist: [1, 3, 14, 22, 16], gain: 1, prompts: [0, 5] },
  { name: "Dreams", artist: "Fleetwood Mac", picks: 6, wins: 2, hist: [0, 0, 3, 8, 9], gain: 1, prompts: [] },
  { name: "QA Fixture Deep Cut", artist: "QA Fixture Band", picks: 2, wins: 0, hist: [0, 1, 2, 2, 0], gain: 0, prompts: [] },
];

const count = (hist: number[]) => hist.reduce((s, n) => s + n, 0);
const sum = (hist: number[]) => hist.reduce((s, n, i) => s + n * (i + 1), 0);

/** Internal: insert the dev fixture into songStats, or add a round to it. */
export const seedDevSongStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.ALLOW_CONTENT_SEED !== "1") {
      throw new Error(
        `contentSeed:seedDevSongStats is disabled: ${SEED_ENV_VAR} is not "1" on this deployment. ` +
          "It writes made-up rows into songStats and must never run on production."
      );
    }
    const now = Date.now();
    const result = { inserted: 0, bumped: 0, skipped: 0 };

    for (const f of FIXTURES) {
      const key = songKey(f.name, f.artist);
      if (!key) continue;
      const prompts: (string | undefined)[] = [undefined];
      f.prompts.forEach((share, i) => {
        if (share > 0 && CURATED_PROMPTS[i]) prompts.push(CURATED_PROMPTS[i]);
      });

      for (const prompt of prompts) {
        const share = prompt === undefined ? f.picks : f.prompts[CURATED_PROMPTS.indexOf(prompt)];
        const fraction = share / f.picks;
        const hist = f.hist.map((n) => Math.round(n * fraction));
        const existing = await ctx.db
          .query("songStats")
          .withIndex("by_song_prompt", (q) => q.eq("songKey", key).eq("prompt", prompt))
          .unique();

        if (!existing) {
          await ctx.db.insert("songStats", {
            songKey: key,
            prompt,
            name: f.name,
            artist: f.artist,
            albumCover: "",
            picks: share,
            wins: Math.round(f.wins * fraction),
            ratingCount: count(hist),
            ratingSum: sum(hist),
            ratingHist: hist,
            sources: [SEED_SOURCE],
            firstSeenAt: now,
            lastSeenAt: now,
          });
          result.inserted++;
          continue;
        }
        if (!existing.sources.includes(SEED_SOURCE)) {
          result.skipped++;
          continue;
        }
        const gain = Math.round(f.gain * fraction);
        if (gain === 0) continue;
        // Each added pick brings three ratings of 4.
        const ratingHist = [...existing.ratingHist];
        ratingHist[3] += gain * 3;
        await ctx.db.patch(existing._id, {
          picks: existing.picks + gain,
          ratingCount: existing.ratingCount + gain * 3,
          ratingSum: existing.ratingSum + gain * 12,
          ratingHist,
          lastSeenAt: now,
        });
        result.bumped++;
      }
    }
    return result;
  },
});
