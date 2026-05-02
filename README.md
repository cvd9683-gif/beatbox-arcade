# Beatbox Arcade

A playful, browser-based hand-gesture rhythm experience. Build a beat on a step sequencer using **pinch gestures tracked by your webcam**, then perform that beat as a falling-note rhythm game that gradually speeds up.

Built with **Vanilla JS + Vite**, **Tone.js** for audio, and **MediaPipe Tasks Vision** for hand tracking. No p5.js, no React.

---

## What it is

Beatbox Arcade has two modes — both single-hand:

1. **Create Mode** — Two-column layout: webcam + hand skeleton on the left, a 4-row × 8-column step sequencer (Hi-hat / Clap / Snare / Kick) + tempo lever + transport controls on the right. Pinch cells to toggle. Pinch buttons OR hover them for 700 ms to fill and trigger. The tempo lever only adjusts when the pinch *starts* on the track and is held — random hand movement won't drift it.
2. **Game Mode — "Echo Beat"** — Simon-Says rhythm memory. The app plays your beat back and lights the pads in time (LISTEN). When it says YOUR TURN, repeat the sequence by pinching the pads. Round 1 = 4 steps, Round 2 = 8, Round 3 = 12, Round 4 = 16. Complete all 4 rounds to win. 3 mistakes ends the run.

---

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). Allow webcam access when prompted.

To produce a static build:

```bash
npm run build
npm run preview   # preview the production build locally
```

The built site lives in `dist/`.

---

## Interaction flow

1. **Allow webcam.** Show your right hand. The yellow ring is your cursor and follows your right index fingertip; pinch (👌) confirms after a brief 150 ms hold.
2. **Pinch over a cell** to toggle that step. **Pinch over a button** (Play, Stop, Clear, Game Mode) to trigger it. Each track is color-coded; rows top→bottom are Hi-hat / Clap / Snare / Kick.
3. **Press Play** (by pinch or click) to loop the beat. The playhead highlights the active step.
4. **Pinch "Game Mode →"** to perform your beat against falling notes.
5. **Game Mode (two-handed):** show **both hands** to play. Each lane labels the required hand + gesture; perform it as the note enters the hit zone. Score Perfect / Good or take a Miss. Combo and fall speed both grow each loop.
6. Use **Restart** to reset, or **← Create Mode** to go back and edit your beat.

The floating webcam preview includes a live debug panel showing each hand's gesture, pinch state + confidence, and the most recent input.

---

## Gesture mappings

### Create Mode (one hand is enough)
- **Pinch** over any cell or button → trigger. Pinch is confirmed after ~100 ms of contact and has a 350 ms cooldown so a single pinch never double-fires.
- The hand cursor shows live state: **white ring** (idle) → **glow** (preview, fingers approaching) → **yellow** (held / triggered).
- Click **CALIBRATE** to capture your open-hand finger-spread for one second — the app then adapts pinch thresholds to your hand. Skip it and defaults are used.

### Game Mode — "Echo Beat" (one hand, memory game)

| Pad     | Action                  | Keyboard |
| ------- | ----------------------- | -------- |
| Hi-hat  | Hover + pinch           | **A**    |
| Clap    | Hover + pinch           | **S**    |
| Snare   | Hover + pinch           | **D**    |
| Kick    | Hover + pinch           | **F**    |

Flow per round:
1. **LISTEN** — Tone.js plays your beat back; matching pads light up in time. Input is disabled.
2. **YOUR TURN** — Repeat the sequence by pinching pads in order. Each pad sounds when you hit it. Wrong pad = mistake (red glitch); right pad = correct (green pulse).

Round lengths: 4 → 8 → 12 → 16 steps (Round 4 reuses the 8-step pattern twice). Empty steps in the source pattern are skipped — only active sounds need to be replayed.

- **Win** = clear all 4 rounds → "You completed the beat" → Play Again or Edit Beat.
- **Lose** = 3 mistakes total → "Beat dropped" → Try Again or Edit Beat.
- **Space** starts the game from the intro/win/lose overlays.

### How the gestures are detected

Detection uses MediaPipe `HandLandmarker` and a few simple, scale-invariant heuristics on the 21 hand landmarks (no model training):

- **Pinch** — thumb tip and index tip are close (relative to hand span).
- **Point** — only the index finger is extended.
- **Open palm** — four fingers extended.
- **Fist** — no fingers extended.

Pinch always wins over other classifications because thumb–index contact is unambiguous.

---

## Keyboard fallback (demo safety)

A hidden keyboard fallback is always active in Game Mode:

- `A` = Hi-hat
- `S` = Clap
- `D` = Snare
- `F` = Kick

In Create Mode, mouse clicks always work as a fallback for cells and buttons. The UI emphasizes hand gestures; the keyboard fallback is intentionally unobtrusive. If the webcam is unavailable or hand tracking fails to load, the app stays usable via mouse + keyboard and shows a status message.

---

## Reliability notes

- Tone.js audio context only starts after the first user interaction (Play button, Game Mode button, or any tap), per browser autoplay policy.
- MediaPipe model files load from a CDN. If they fail, the app stays interactive via mouse/keyboard.
- Status messages at the bottom describe what's happening: *Loading hand tracking…*, *Webcam ready*, *Hand detected*, *No hand detected*, *Webcam unavailable, fallback enabled*.

---

## Deploying to GitHub Pages

This repo's Vite config sets `base: './'`, so a build produces relative URLs that work on any GitHub Pages subpath.

**Option A — gh-pages branch via the `gh-pages` package:**

```bash
npm install --save-dev gh-pages
npm run build
npx gh-pages -d dist
```

Then in your GitHub repo: **Settings → Pages → Branch: `gh-pages`, folder: `/ (root)`**.

**Option B — GitHub Actions:**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
```

Then in GitHub: **Settings → Pages → Source: GitHub Actions**.

If you want absolute paths instead (e.g. you're hosting at `https://<user>.github.io/beatbox-arcade/`), change `vite.config.js`:

```js
export default defineConfig({ base: '/beatbox-arcade/' });
```

---

## Project layout

```
beatbox-arcade/
├── index.html
├── package.json
├── vite.config.js
├── README.md
└── src/
    ├── main.js          # entry point + mode switching + keyboard fallback
    ├── handTracking.js  # MediaPipe HandLandmarker wrapper + gesture classifier
    ├── audioEngine.js   # Tone.js synthesized drums (kick/snare/hihat/clap)
    ├── sequencer.js     # Create Mode: grid, playhead, pinch-to-toggle
    ├── gameMode.js      # Game Mode: falling notes, scoring, speedup
    └── styles.css
```

---

## Tech notes

- Audio is fully synthesized so there are no sample files to ship.
- Pinch on a cell uses a debounce so a single sustained pinch doesn't toggle the same cell repeatedly.
- The cursor is normalized in webcam space and mapped to viewport coordinates; the webcam image is mirrored so movement feels natural.
- Game Mode auto-triggers each note's sound as it crosses the hit zone (so you always hear your beat), and scores you on the timing of the matching gesture.
