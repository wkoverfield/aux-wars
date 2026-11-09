/**
 * Search metadata for the pages the build writes as static HTML (see
 * src/prerender/ and the prerender plugin in vite.config.js). Plain data so
 * the build can read it. Each entry becomes <file> in dist with this title,
 * description and canonical URL, and the page's markup already in #root.
 *
 * Every page listed with `index: true` must also be in public/sitemap.xml.
 * Routes not listed here (lobby, screen, /g/ results, /pro, /stats) are served
 * from the noindex app shell, and unknown paths get 404.html with a 404 status
 * (see vercel.json).
 */
export const SITE = 'https://www.aux-wars.com';

export const PAGES = [
  {
    path: '/',
    file: 'index.html',
    index: true,
    // Home keeps the head written in index.html (HOME_TITLE).
    title: null,
    description: null,
  },
  {
    path: '/faq',
    file: 'faq.html',
    index: true,
    title: 'Aux Wars FAQ: How to Play the Online Aux Battle Game',
    description:
      'What an aux battle is, how many people can play, how scoring works and where the songs come from. Aux Wars is free, with no account or download.',
  },
  {
    path: '/aux-battle',
    file: 'aux-battle.html',
    index: true,
    title: 'What Is an Aux Battle? How to Play One Online | Aux Wars',
    description:
      'An aux battle is a game where friends pick songs for the same prompt and rate each other’s picks. Here is how it works and how to play one online for free.',
  },
  {
    path: '/privacy',
    file: 'privacy.html',
    index: true,
    title: 'Privacy Policy | Aux Wars',
    description:
      'What Aux Wars collects, how ads and cookies work, and which services run the game.',
  },
  {
    path: '/404',
    file: '404.html',
    index: false,
    title: 'Page not found | Aux Wars',
    description: null,
  },
];

export function pageFor(path) {
  return PAGES.find((page) => page.path === path);
}

/** The <title> in index.html. Pages restore it when they unmount. */
export const HOME_TITLE = 'Aux Wars - Online Aux Battle Music Party Game with Friends';
