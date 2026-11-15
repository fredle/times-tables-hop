# Times Tables Hop

A game you play with your voice. A frog is crossing a busy road; each lane
shows a question and a car starts driving at you. Say the right answer out
loud to hop out of the way before it arrives.

Four games, picked on the start screen:

- **Numbers 1-9**: say the number you see (reception age).
- **Letters**: say the letter you see.
- **Words**: read a simple three-letter word (cat, dog, sun).
- **Times tables**: choose which tables, answer the multiplication.

It runs as a website and as an iPhone app, from the same game code.

## iPhone app

Install from TestFlight. Speech recognition is Apple's, on the phone itself
where the device supports it, so there is no account, no server and nothing
to set up. The app asks for the microphone and speech recognition the first
time you press Play. Scores and settings are stored on the phone.

## Website

1. Copy `.env.example` to `.env` and paste in an AssemblyAI API key.
2. Start the server:

   ```bash
   npm start
   ```

3. Open http://localhost:5177 and allow the microphone.

Without a key the game still works, with typed answers only. The microphone
only works on `localhost` or over HTTPS.

## How it works

- `server.js`: zero-dependency Node server. Serves `public/` and exposes
  `POST /api/token`, which swaps the secret API key for a 60-second AssemblyAI
  streaming token. The key never reaches the browser.
- `public/voice.js` + `pcm-worklet.js`: in a browser, capture the mic as 16 kHz
  PCM and stream it to AssemblyAI. In the iPhone app, hand over to native
  speech recognition instead.
- `public/numbers.js`, `public/reading.js`: turn transcripts ("um, fifty six",
  "56.", "bee" for b) into answers. Tested in `test/` (`npm test`).
- `public/game.js`: the game. Answers are judged on partial transcripts, so
  the frog hops as soon as the answer is heard. Missed questions come back a
  couple of questions later. Listening stops whenever no game is being played.
- `ios/`: the iPhone shell (SwiftUI + `WKWebView`), built and uploaded to
  TestFlight by `.github/workflows/ios.yml`.

## Privacy

- iPhone app: no analytics, no accounts, no network calls of its own. Audio
  is recognised on the phone when the device supports on-device recognition;
  otherwise Apple's speech service is used.
- Website: audio is streamed to AssemblyAI while a game is being played.
