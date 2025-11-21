# aux wars

settle music taste arguments with your friends

**play at [aux-wars.com](https://aux-wars.com)**

## what it is

party game where you pick songs for weird prompts and rate each other's choices. whoever gets the most points wins.

prompts are stuff like "this song could start a mosh pit" or "a song that makes you wanna text your ex"

## why it exists

got tired of fighting over the aux with my friends. now we can just prove who the real ball-knower is.

features:

- works on phones
- no signups or logins
- uses youtube so most songs are available
- real-time voting
- custom prompts if you want

## tech stuff

- react + vite
- socket.io for real-time
- node/express backend
- youtube integration
- tailwind css
- deployed on vercel + railway

## run it locally

clone and install:

```bash
git clone https://github.com/woverfield/aux-wars.git
cd aux-wars
npm run install-all
```

create `.env` files:

**client/.env**:

```
VITE_SERVER_URL=http://localhost:3001
```

**server/.env**:

```
CLIENT_ORIGIN=http://localhost:5173
PORT=3001
```

start it:

```bash
npm start
```

open `localhost:5173`

## deployment

using vercel for frontend and railway for backend. set your environment variables and update cors settings to match your domains.

## future ideas

- tournament mode
- public lobbies
- stats tracking
- theme nights

## credits

built during late night coding sessions

shoutout to my friends for beta testing and submitting terrible songs
