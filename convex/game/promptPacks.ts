/**
 * Curated prompt packs, server side.
 *
 * Mirrors client/src/data/promptCategories.js, which drives the pack picker in
 * private rooms. Quick Play rooms have no host to pick prompts, so the server
 * seeds them from these packs directly. convex/promptPacks.test.ts fails if
 * the two copies drift: change both together.
 */

export type PromptPack = {
  id: string;
  name: string;
  icon: string;
  prompts: string[];
};

export const PROMPT_PACKS: PromptPack[] = [
  {
    id: "vibes",
    name: "Vibes & Moods",
    icon: "✨",
    prompts: [
      "This song makes me feel like the main character.",
      "The soundtrack to a late-night drive.",
      "A song that instantly boosts your confidence.",
      "This song would play in the background of my villain arc.",
      "A song that could make me cry on the right day.",
      "A song that makes you feel unstoppable.",
    ],
  },
  {
    id: "party",
    name: "Party & Energy",
    icon: "🎉",
    prompts: [
      "The perfect song to play while getting ready to go out.",
      "This song could start a mosh pit.",
      "The ultimate cookout anthem.",
      "A song that instantly hypes up the whole room.",
      "A song that just feels like summertime.",
    ],
  },
  {
    id: "memories",
    name: "Memories & Stories",
    icon: "💭",
    prompts: [
      "This song makes me wanna text my ex (or block them).",
      "A song that defines high school memories.",
      "This song is pure nostalgia.",
      "If life had a montage, this song would play in mine.",
    ],
  },
  {
    id: "throwbacks",
    name: "Throwbacks",
    icon: "🕰️",
    prompts: [
      "A song that takes you straight back to middle school.",
      "The song that was on every road trip growing up.",
      "A 2010s banger that still goes off.",
      "A song your older sibling made you love.",
      "The throwback that turns into an instant group singalong.",
    ],
  },
  {
    id: "feels",
    name: "In My Feels",
    icon: "💔",
    prompts: [
      "The song you play when you need a good cry.",
      "A breakup song that hits a little too hard.",
      "The song for staring out a rainy window dramatically.",
      "A song that romanticizes being sad.",
      "The song on your 3am overthinking playlist.",
    ],
  },
  {
    id: "hype",
    name: "Hype & Gym",
    icon: "🔥",
    prompts: [
      "The song that makes you add five more pounds to the bar.",
      "A song that makes you feel like you could fight a bear.",
      "The walkout song for your big fight.",
      "A song that turns a normal walk into a movie scene.",
      "The song that's illegal to play if you actually have things to do.",
    ],
  },
  {
    id: "unhinged",
    name: "Unhinged",
    icon: "😈",
    prompts: [
      "A song you're lowkey embarrassed to love.",
      "The song that lives in your head rent-free.",
      "A song that's objectively bad but you'd defend with your life.",
      "The most chaotic song on your playlist.",
      "A song that would get you banned from the aux cord.",
      "A guilty pleasure you'd deny in public.",
    ],
  },
  {
    id: "crushing",
    name: "Crushing",
    icon: "💘",
    prompts: [
      "The song that reminds you of your biggest crush.",
      "A song you'd want for your first dance.",
      "The song that makes you believe in love again.",
      "A song that's basically a love letter.",
      "The song you'd dedicate to someone (anonymously).",
    ],
  },
];

/** Every curated prompt, in pack order. The prompt pool of a Quick Play room. */
export const CURATED_PROMPTS: string[] = PROMPT_PACKS.flatMap((pack) => pack.prompts);
