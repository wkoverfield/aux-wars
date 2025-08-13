# 🎵 Aux Wars

A multiplayer music game where you and your friends compete to find the perfect song for each round's prompt. Think you have the best music taste? Prove it!

## 🎮 How to Play

1. **Join or Host**: Create a new game or join with a friend's code  
2. **Get the Prompt**: Each round starts with a fun prompt like "This song makes me feel like the main character"  
3. **Pick Your Song**: Search YouTube for the perfect track  
4. **Rate & Compete**: Rate other players' songs on a scale of 1-5 records  
5. **Win**: Collect the most records to become the ultimate music master!  

## ✨ Features

- 🎯 Real-time multiplayer gameplay  
- 🎵 YouTube integration for song selection  
- 🎨 Beautiful, responsive UI  
- 🎮 No user authentication required  
- ⚡ Quick and easy setup  
- 🎲 Customizable game settings  

## 🚀 Current Status

**Aux Wars now uses YouTube API** for music search and playback, removing the need for user authentication!  
No more whitelisting or user limits - anyone can play!  

## 🎧 How to Set Up and Play

1. **Get a YouTube API Key**  
   - Go to [Google Cloud Console](https://console.cloud.google.com/)  
   - Create a new project or select existing one  
   - Enable the YouTube Data API v3  
   - Create credentials (API Key)  
   - Copy your API key  

2. **Clone & Set Up the Repo**  
```bash
git clone https://github.com/yourusername/aux-wars.git
cd aux-wars
npm run install-all
```

3. **Configure Your Environment**
   Create a `.env` file in the `/client` directory:

```
VITE_YOUTUBE_API_KEY=your_youtube_api_key_here
```

4. **Run Locally**

```bash
npm run start
```

Then open `http://localhost:5173` in your browser and start playing!

**Note:** YouTube API has a generous free quota (10,000 units per day), which is plenty for personal use.

## 🛠️ Development

### Client

```bash
cd client
npm run dev     # Start development server
npm run test    # Run tests
npm run build   # Build for production
```

### Server

```bash
cd server
npm start       # Start server
npm test        # Run tests
```

## 🎯 Requirements

* Node.js v18+
* npm v9+
* YouTube API Key (free)
* Modern web browser

## 🤝 Contributing

We love contributions! Whether it's:

* 🐛 Bug fixes
* ✨ New features
* 📝 Documentation improvements
* 🎨 UI/UX enhancements

1. Fork the repo
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 🙏 Acknowledgments

* YouTube API for music search
* Socket.IO for real-time communication
* React & Vite for the frontend
* All our amazing contributors!

---

Made with ❤️ by music lovers, for music lovers
