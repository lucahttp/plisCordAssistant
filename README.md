# 🎙️ PlisCord Assistant

A performant, on-device voice assistant framework built for Discord bots and driving assistance. Uses local AI models for privacy-first, low-latency voice interactions.

## ✨ Features

| Feature | Technology | Description |
|---------|------------|-------------|
| 🎤 **Wake Word Detection** | [Hey Buddy](https://github.com/painebenjamin/hey-buddy) | Custom wake words like "Hey Buddy", "OK Computer" |
| 🗣️ **Speech Recognition** | [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) | Fast local transcription (ONNX) |
| 🧠 **Function Calling** | [FunctionGemma 270M](https://huggingface.co/google/functiongemma-2b) | Lightweight intent recognition & tool execution |
| 🔊 **Text-to-Speech** | [Supertonic 2](https://huggingface.co/Supertone/supertonic-2) | Natural voice synthesis |
| 🤖 **Discord Bot** | discord.js + @discordjs/voice | Voice channel integration |
| 🚗 **Driving Mode** | Headless CLI | Ultra-lightweight for car PCs |

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    PlisCord Assistant Core                      │
├────────────────────────────────────────────────────────────────┤
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐     │
│  │ Wake Word│   │  Whisper │   │ Function │   │Supertonic│     │
│  │(HeyBuddy)│ → │   STT    │ → │  Gemma   │ → │   TTS    │     │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘     │
│       ↑              ↑              ↓              ↓           │
│   Audio In      Transcription   Tool Calls     Audio Out       │
└────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
     │   Discord   │ │   Driving   │ │    API      │
     │     Bot     │ │  Assistant  │ │   Server    │
     └─────────────┘ └─────────────┘ └─────────────┘
```

## 📦 Project Structure

```
plisCordAssistant/
├── core/                    # Shared voice processing engine
│   ├── pipeline.js          # Main audio processing pipeline
│   ├── wakeword/            # HeyBuddy wake word detection
│   ├── stt/                 # Whisper transcription
│   ├── function-caller/     # FunctionGemma intent recognition
│   ├── tts/                 # Supertonic text-to-speech
│   └── tools/               # Available tool implementations
│
├── discord-bot/             # Discord voice bot
│   ├── index.js             # Bot entry point
│   ├── voice-handler.js     # Voice channel management
│   └── commands/            # Slash commands
│
├── driving-assistant/       # Headless driving mode
│   ├── index.js             # CLI entry point
│   ├── audio-driver.js      # System audio I/O
│   └── config.json          # Performance settings
│
├── tools/                   # Tool implementations
│   ├── youtube.js           # Play YouTube music
│   ├── search.js            # Web search
│   ├── invite.js            # Game invite notifications
│   └── navigation.js        # Car navigation (driving mode)
│
├── models/                  # Downloaded AI models (gitignored)
├── package.json
└── README.md
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- FFmpeg (for Discord voice)
- Microphone access
- ~2GB disk space for models

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/plisCordAssistant.git
cd plisCordAssistant

# Install dependencies
npm install

# Download AI models
npm run download-models

# Start Discord bot
npm run discord

# OR Start driving assistant
npm run drive
```

## 🎯 Available Commands

The AI understands natural language and maps to these functions:

| Intent | Example | Action |
|--------|---------|--------|
| 🎵 **Play Music** | "Play Bohemian Rhapsody" | YouTube search & play |
| 🔍 **Search** | "Search for pizza nearby" | Web search with TTS response |
| 👥 **Invite Friend** | "Invite John to play Valorant" | Send Discord notification |
| 🗺️ **Navigate** | "Navigate to home" | Open navigation (driving mode) |
| ⏸️ **Media Control** | "Pause", "Skip", "Volume up" | Control playback |

## ⚙️ Configuration

### Discord Bot (`discord-bot/config.json`)
```json
{
  "token": "YOUR_DISCORD_BOT_TOKEN",
  "wakeWord": "hey buddy",
  "autoJoin": true,
  "voiceChannels": ["General", "Gaming"]
}
```

### Driving Assistant (`driving-assistant/config.json`)
```json
{
  "wakeWord": "ok computer",
  "performanceMode": "potato",
  "ttsVoice": "M3",
  "audioDevice": "default"
}
```

### Performance Modes

| Mode | RAM Usage | CPU Usage | Quality |
|------|-----------|-----------|---------|
| `potato` | ~500MB | Low | Good |
| `balanced` | ~1GB | Medium | Better |
| `quality` | ~2GB | High | Best |

## 📚 Dependencies

- `@huggingface/transformers` - AI model inference
- `onnxruntime-node` - ONNX runtime for Node.js
- `discord.js` - Discord API
- `@discordjs/voice` - Voice channel support
- `play-dl` - YouTube audio extraction
- `node-vad` - Voice activity detection

## 🔧 Development

```bash
# Run tests
npm test

# Development mode with hot reload
npm run dev

# Build for production
npm run build
```

## 📄 License

MIT License - Feel free to use, modify, and distribute.

---

<p align="center">
  <strong>🎙️ PlisCord - Your local, private voice assistant</strong>
</p>