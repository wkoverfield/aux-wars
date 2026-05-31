import { Link } from 'react-router-dom';

/**
 * Privacy Policy — required for AdSense approval and cookie consent.
 * Plain, honest, and accurate to how Aux Wars actually works.
 */
export default function PrivacyPolicy() {
  return (
    <div className="min-h-svh w-full text-white px-6 py-12 flex justify-center">
      <div className="max-w-2xl w-full">
        <Link to="/" className="text-[#68d570] underline text-sm">← Back to Aux Wars</Link>
        <h1 className="text-3xl font-bold mt-6 mb-2">Privacy Policy</h1>
        <p className="text-gray-400 text-sm mb-8">Last updated: May 31, 2026</p>

        <div className="space-y-6 text-gray-300 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-2">The short version</h2>
            <p>
              Aux Wars is a free party game with no accounts and no logins. We don't ask for
              your name beyond a temporary display name you type for a game, and we don't sell
              your personal information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">What we collect</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>A temporary display name and an anonymous game/session identifier, used only to run the game in real time.</li>
              <li>Your song picks and ratings within a game.</li>
              <li>Anonymous, aggregate usage analytics (e.g. how many games are played).</li>
            </ul>
            <p className="mt-2">Game rooms are temporary and are automatically cleaned up after they end.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Cookies &amp; advertising</h2>
            <p>
              If advertising is enabled, we use Google AdSense to show ads, which may set cookies
              to measure and personalize advertising. We ask for your consent before serving these
              ads, and you can decline. Ads are never shown to players in a room hosted with the
              ad-free Pro pack.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Third-party services</h2>
            <p>
              We use the iTunes Search API and Deezer API to find songs and play 30-second
              previews, Convex to run real-time game state, and Google AdSense for advertising
              (when enabled). Each handles data under its own policies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Contact</h2>
            <p>
              Questions about this policy? Reach out via the Feedback button in the app.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
