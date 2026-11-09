import { Link } from 'react-router-dom';
import AdSlot from '../../components/AdSlot';
import { usePageTitle } from '../../hooks/usePageTitle';

// Facts here track the game: rounds 1 to 10 (updateSettings in
// convex/game/rooms.ts), FREE_PLAYER_CAP, ratings 1 to 5 (submitRating in
// convex/game/flow.ts), and the prompt pack names in data/promptCategories.js.
const HOW_IT_PLAYS = [
  {
    title: 'Rounds',
    text: 'The host picks how many rounds to play, from 1 to 10. Every round has one prompt, and everyone answers the same one.',
  },
  {
    title: 'Prompts',
    text: 'Use the built-in prompt packs, like Throwbacks, In My Feels and Unhinged, or write your own in the lobby. Custom prompts are where inside jokes go.',
  },
  {
    title: 'Picking',
    text: 'Everyone searches for a song that fits the prompt and locks it in. Picks play from YouTube, so almost any song works.',
  },
  {
    title: 'Rating',
    text: "Each pick plays for the group and everyone rates it from 1 to 5. You can't rate your own. The best average rating wins the round, and the most round wins takes the game.",
  },
  {
    title: 'Local Play',
    text: 'In the same room? The host turns on Local Play, and one screen, like a TV or a laptop, plays the music while everyone picks and votes on their own phone.',
  },
];

/**
 * What an aux battle is and how Aux Wars runs one. The build renders this
 * component into aux-battle.html (see src/prerender/), so it must render
 * without browser APIs or Convex data.
 */
export default function AuxBattle() {
  usePageTitle('/aux-battle');

  return (
    <div className="h-full w-full overflow-y-auto text-white px-6 py-12 flex justify-center">
      <div className="max-w-2xl w-full pb-16">
        <Link to="/" className="text-[#68d570] underline text-sm">← Back to Aux Wars</Link>
        <h1 className="text-3xl font-bold mt-6 mb-4">What is an aux battle?</h1>
        <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
          <p>
            An aux battle is a game for settling who has the best music taste. Everyone gets the
            same prompt, like a song for a late night drive, and picks a song for it. The group
            listens to every pick and decides whose song fit best.
          </p>
          <p>
            Friends have always done this by passing the aux cord around in the car or at a
            party. Aux Wars runs the same game in the browser, so it works when you&apos;re in the
            same room or on a call.
          </p>
        </div>

        <h2 className="text-xl font-bold mt-10 mb-4">How Aux Wars does it</h2>
        <dl className="space-y-6">
          {HOW_IT_PLAYS.map(({ title, text }) => (
            <div key={title}>
              <dt className="text-lg font-semibold text-white">{title}</dt>
              <dd className="text-sm text-gray-300 leading-relaxed mt-1">{text}</dd>
            </div>
          ))}
        </dl>

        <h2 className="text-xl font-bold mt-10 mb-4">What you need</h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          2 to 8 players, each with a phone or a computer. It&apos;s free, with no account and no
          download. One person hosts a room and shares the code, and everyone else joins with it.
        </p>

        <Link to="/" className="inline-block mt-10 py-3 px-6 rounded-full font-bold text-black bg-[#68d570] hover:bg-[#7de884] transition-colors">
          Play an aux battle
        </Link>
        <p className="mt-6 text-xs text-gray-400">
          More questions?{' '}
          <Link to="/faq" className="underline underline-offset-2 hover:text-white">Read the FAQ</Link>
        </p>
        <AdSlot slot="auxBattle" className="mt-10" />
      </div>
    </div>
  );
}
