/**
 * The FAQ page's content. Plain data (no JSX) because the build also reads
 * it: vite.config.js writes /faq.html with these answers already in the
 * markup and the page's own title, description and canonical URL.
 *
 * Facts here track the game's rules: FREE_PLAYER_CAP in
 * convex/game/rooms.ts, rating values in submitRating (convex/game/flow.ts).
 */
export const FAQ_PAGE = {
  path: '/faq',
  title: 'Aux Wars FAQ: How to Play the Online Aux Battle Game',
  description:
    'What an aux battle is, how many people can play, how scoring works and where the songs come from. Aux Wars is free, with no account or download.',
};

export const FAQ = [
  {
    q: 'What is an aux battle?',
    a: 'A game where friends compete on the aux to prove who has the best music taste. Aux Wars runs it online: everyone gets the same prompt, picks a song for it, and the group rates each pick.',
  },
  {
    q: 'How many people can play?',
    a: '2 to 8 players per room, and 1v1 works. No one around? Quick Play puts you in a room with other players.',
  },
  {
    q: 'Is it free? Do I need an account?',
    a: "It's free, with no account and no download. It runs in the browser on any phone or computer.",
  },
  {
    q: 'How does scoring work?',
    a: "Everyone rates each song from 1 to 5, and you can't rate your own. The best average rating wins the round, and the most round wins takes the game.",
  },
  {
    q: 'Where do the songs come from?',
    a: 'Search for any song by name or artist. Picks play from YouTube, so almost anything is fair game.',
  },
  {
    q: 'Can we play together in the same room?',
    a: 'Yes. The host turns on Local play in Game Settings and opens the address it shows on a TV, a laptop, or one phone in the middle of the table. That screen plays the music while everyone picks and votes on their own phone.',
  },
  {
    q: 'Can we use our own prompts?',
    a: 'Yes. Pick from prompt packs like Throwbacks, In My Feels and Unhinged, or write your own in the lobby.',
  },
];
