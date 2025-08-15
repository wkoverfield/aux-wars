# 🎵 Aux Wars

Ever argued with your friends about who has the best music taste? Time to settle it once and for all.

**Play it now at [aux-wars.com](https://aux-wars.com)**

## 🎥 See it in action

[Video Demo - Watch on YouTube/Loom]

*↑ Add your video demo link here*

## What is Aux Wars?

It's basically a party game where you compete with friends to pick the best songs for ridiculous prompts. Think Cards Against Humanity meets Spotify queue battles.

You get prompts like "This song could start a mosh pit" or "A song that makes you wanna text your ex" and everyone submits their best pick. Then you all rate each other's choices and whoever gets the most points wins. Simple as that.

## 📸 Screenshots

### The Lobby
![Lobby Screenshot](screenshots/lobby.png)
*Where you gather your crew and talk trash before the game*

### Song Selection 
![Song Selection](screenshots/song-selection.png)
*Finding that perfect track for the prompt*

### Rating Songs
![Rating Screen](screenshots/rating.png)
*Judge your friends' questionable music taste*

### Victory Screen
![Winner](screenshots/winner.png)
*Bragging rights included*

*↑ Add your screenshots to a `/screenshots` folder*  

## Why I Built This

Honestly? I was tired of fighting over the aux cord. This way everyone gets their turn and we can finally prove who really knows music.

Some cool stuff about it:
- Works on phones (crucial for parties)
- No signups or logins (just send the game code)
- Uses YouTube so basically every song ever made is available
- Real-time everything - see votes as they happen
- Custom prompts if you want to get weird with it  

## The Tech Stack (for my fellow devs)

I went with:
- **React + Vite** for the frontend (it's 2024, we're not using Create React App)
- **Socket.io** for the real-time stuff
- **Node/Express** backend 
- **YouTube integration** for music search (no auth needed!)
- **Tailwind** for styling because I'm not a masochist
- Deployed on **Vercel** (frontend) and **Railway** (backend)  


## Running it Locally

If you want to run your own version:

1. Clone it:
```bash
git clone https://github.com/woverfield/aux-wars.git
cd aux-wars
npm run install-all
```

2. Make some `.env` files:

**Client** (`/client/.env`):
```
VITE_SERVER_URL=http://localhost:3001
```

**Server** (`/server/.env`):
```
CLIENT_ORIGIN=http://localhost:5173
PORT=3001
```

4. Fire it up:
```bash
npm start
```

That's it. Hit up `localhost:5173` and you're good to go.

## Deployment

I'm using Vercel for the frontend and Railway for the backend. Both have free tiers that work fine for this.

If you're deploying your own:
- Make sure to set the environment variables in both services
- Update the CORS settings to match your domains
- YouTube search is handled server-side to avoid CORS issues


## Future Ideas

Some stuff I might add in the future:
- Tournament mode
- Public lobbies to play with randoms
- Stats tracking (biggest upsets, worst picks, etc)
- Theme nights (only 90s music, only movie soundtracks, etc)

## Credits

Built by me during late night coding sessions fueled by love for music.

Shoutout to:
- My friends for beta testing and submitting terrible songs

---

Questions? Bugs? Bad song recommendations? Hit me up or open an issue.

*P.S. - "Wonderwall" is banned in my lobbies*
