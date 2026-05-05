# Beatbox Arcade — How It Was Made

## Where it started

The project began as a **physical instrument**. The original idea was a tabletop beat-maker where you'd pick up wooden or 3D-printed blocks and place them on a grid — each block a sound, each row a track, each column a step in the bar. The appeal was tactile: you'd *build* a beat with your hands, not click it into existence.

Two things killed the physical version: time, and the messy reality of sensing block placement reliably (RFID tags, fiducial markers, computer vision over the grid — all doable, none cheap). So we pivoted to a digital prototype.

But I didn't want to just rebuild a drum machine in a browser. The whole point of the physical version was the feeling that *your hands made the music*. If we were going digital, the interaction had to keep that feeling — otherwise it's just another sequencer.

## The core design idea: keep the hands in the loop

That constraint pointed me at **gesture-based interaction**. Instead of clicking buttons, you'd:

- **hover** with one hand to aim at a cell
- **pinch** with the other to commit (place a beat, confirm a control)
- **spread** your fingers to control intensity (chord swell, arpeggio speed)

Two reasons this felt right:

**It preserves the tactile metaphor.** The original blocks needed two motions — pick it up, set it down. Pinching has the same two-stage feel: close your fingers, open them. Hovering with the other hand is the "where" before the "place." Splitting the action across two hands means you're not just gesturing at a screen, you're *operating* something.

**It rules out muscle memory shortcuts.** With a mouse, you'd just spam-click cells and it'd feel like a checkbox grid. With pinch + aim, every beat you place is a small intentional act. That slows you down in a good way and makes the result feel earned.

The tradeoff: gestures are less precise than a mouse, and that precision gap had to be designed around.

## Hand tracking: how MediaPipe actually works

Under the hood I'm using **MediaPipe Tasks Vision** — Google's open-source hand-landmark model — running in the browser via WebAssembly with `numHands: 2`.

Conceptually, MediaPipe takes each frame of webcam video and returns **21 landmarks per hand**: one per finger joint plus the wrist, each with `(x, y, z)` coordinates normalized to the image. So I always know where the thumb tip, index tip, knuckles, and palm are. From there it's geometry.

I derive three things per hand, every frame:

- **Cursor position** — the index fingertip, mirrored horizontally so the on-screen cursor moves with you, not against you.
- **Pinch state** — Euclidean distance between thumb tip and index tip, normalized by hand size. Below a threshold = pinched.
- **Spread / openness** — for the performance mode, the spread between thumb and index measured the same way, but mapped continuously instead of as a binary.

Two refinements made this usable instead of frustrating:

**Cursor smoothing.** Raw fingertip coordinates jitter — by a few pixels every frame from sensor noise alone. I run an **exponential moving average** over the position so the on-screen cursor lags the real fingertip by a tiny amount but doesn't shake. This is a single multiply-and-add per frame: `smoothed = smoothed * (1 - α) + raw * α`. Higher α = more responsive but more jittery. I tuned it by feel.

**Pinch hysteresis.** A single pinch threshold causes "fluttering" — your fingers hover right at the boundary and the system thinks you're pinching/releasing twenty times a second. So I use **two thresholds**: a tighter one to *enter* the pinch state, and a looser one to *exit*. Once you're committed to a pinch, you have to clearly open your hand to leave it. This came directly from user testing — early demos had ghost-placements and people thought the system was broken.

**Hand-role assignment.** When both hands are visible, I sort the cursors by mirror-corrected x-coordinate: rightmost cursor = right hand. This is more reliable than MediaPipe's own handedness label, which sometimes flips. With one hand visible, I fall back to MediaPipe's classifier with a flip flag.

## Two interaction modes, two interface logics

The prototype has two main modes that share the gesture vocabulary but use it for very different things.

### Create Mode — building the beat

This is the original "place blocks" idea, digitized.

- A **4×8 grid**: rows are `hi-hat / clap / snare / kick`, columns are 16th-note steps in a 2-beat loop.
- **Right hand aims** — your right index fingertip drives a cursor over the grid. The cell under it gets a yellow `aimed` highlight.
- **Left hand pinches to place** — pinching with your left hand toggles whatever cell is currently aimed.

I deliberately split the roles so the two hands aren't fighting for the same job. Right pinch on a cell does *nothing* — that ambiguity-removal was a usability fix from testing, where people would try to pinch with the same hand they were aiming and the system couldn't tell what they meant.

For UI controls (buttons, the tempo panel) I added **hover-dwell**: hold your cursor over a button for **700ms** and it fills up like a progress ring and confirms. This gives users who haven't figured out pinching yet a reliable fallback, and it works for people demoing one-handed.

The **tempo panel** sits inline beside the grid as a vertical rail. You hover-dwell on the ADJUST pad to enter Tempo Mode, then your **left hand's vertical position maps to BPM 70–150**. Dwell on SET to commit. BPM never changes outside Tempo Mode, which means you can't accidentally tempo-change while building beats.

### Performance Mode — playing the song

Once you've got a beat, Performance Mode lets you play *over* it expressively. This is where harmony and melody come in.

The screen splits visually into two halves matching the two hands:

- **Left side: chord grid.** Four chord pads laid out horizontally — `Am (Dark) · F (Dreamy) · C (Bright) · G (Lifted)`. Hovering your left hand picks the chord; **spreading your thumb and index finger opens it**.
- **Right side: arpeggio surface.** A vertical zone where your right hand triggers the arpeggio; **spreading your fingers speeds it up**.

The chord opening isn't a binary on/off — it's a continuous swell. Spread maps to multiple parameters at once:

- **Volume** ramps up
- **Filter cutoff** sweeps from 800Hz (closed, muffled) to 5000Hz (open, bright)
- **Reverb send** rises from 0.20 to 0.70
- **Past 30% spread**, a bass note kicks in playing the chord root an octave lower

So a closed pinch is a soft, dry, narrow chord whisper. A full open palm is a wide, bright, bass-supported chord wash. You're not just choosing chords — you're *performing* them.

### Onboarding had to be staged

Early demos: I'd hand someone the webcam, they'd look at four chord zones and an arpeggio surface, and freeze. Too much.

So Performance Mode now uses a **3-step staged tutorial**:

1. **Harmony first.** Only the left chord grid is interactive. "Open the chord" — hover, spread, hear it bloom.
2. **Arpeggio next.** Right side unlocks. "Shape the arpeggio" — same hover-then-spread vocabulary, applied to a new role.
3. **Full instrument.** Both hands live, with playback controls available.

Each stage advances when the user explicitly confirms (a hover-dwell on Continue), so people set their own pace. This addressed the freeze: complexity gets introduced one capability at a time.

I also kept large, persistent **role labels** next to the webcam preview (`RIGHT HAND = AIM`, `LEFT PINCH = PLACE`) and a numbered "how to" card. Demos taught me that even after a tutorial, people forget — so the labels are always visible, not just on first run.

## Sound design and the audio system

This is the part the project actually lives or dies on. Gestures are cool; gestures that produce bad sound are useless.

### Everything is Tone.js, no samples

I used **Tone.js** (a Web Audio framework) for the entire audio engine. There are no audio file samples — every sound is synthesized in real time. That kept the bundle small (~427KB JS total) and meant I had full control over each sound.

The drum kit is built from Tone.js primitives:

- **Kick** — `MembraneSynth` with a low base frequency and fast pitch envelope (the "thud" + "click" of a kick).
- **Snare** — two layers: a `NoiseSynth` body for the rasp + a short tuned `Synth` for the snap.
- **Hi-hat** — high-passed `NoiseSynth` with a tight envelope.
- **Clap** — band-passed pink noise, retriggered to fake the layered slap of human hands.

These are simple recipes by drum-synthesis standards but they read as recognizable percussion, and because they're synths I can change tempo without time-stretching artifacts.

### How the grid triggers sound

Tone.js has a `Transport` — a global musical clock that handles BPM, scheduling, and looping. I schedule a callback every 16th note. On each tick, the callback reads `pattern[track][step]` for the current step and fires any track that has a `1` there. The pattern array is the source of truth; the visual grid and the audio engine both read from it.

This means **placing a block is an O(1) state mutation** — flip one boolean. Audio scheduling is decoupled from rendering, so there's no audio glitch when the UI updates.

### The three musical layers

Performance Mode adds two more layers on top of the drums:

**1. Chord pad (harmony, left hand).** A `PolySynth` of `fatsine` oscillators (3 detuned sines per voice, +18 cents spread) feeds into a chain: filter → reverb → output. Selecting a chord triggers a sustained attack on all four chord notes; the chord stays held while your hand is in that zone. Spread modulates the filter cutoff and reverb send live, so the same chord can whisper or shout depending on your hand.

**2. Arpeggio (melody, right hand).** A separate `PolySynth` (so each scheduled note gets its own voice and they don't choke each other). The arpeggio runs an internal step counter and walks through the chord's notes in a pattern. **Spread on the right hand controls the step interval** — closed = slow (eighth notes), open = fast (sixteenths or faster). The synth itself is a brighter pluck-style voice so it sits above the pad without muddying it.

**3. Bass (chord root, automatic).** A `MonoSynth` that attacks at `leftSpread > 0.30` and releases below 0.25, playing the chord root one octave lower. I added hysteresis here for the same reason as the pinch detector — without it, the bass would flicker on and off at the threshold and sound terrible.

### Why it always sounds in key

This was the design constraint that made the rest possible. The four chords (`Am, F, C, G`) are all in the **key of C major / A minor**. Each chord pad has both a `chord` array (the notes for the pad) and a `scale` array (the notes the arpeggio is allowed to use while that chord is active). The arpeggio reads from the active chord's scale — so it can never play a "wrong" note relative to what the left hand is holding.

The user has full expressive freedom inside a curated palette. They feel like they're improvising; the system is quietly preventing dissonance. This is the same trick as Ableton's scale mode or Garageband's smart instruments — it's not novel, but it's the difference between "this sounds like music" and "this sounds like a kid mashing a piano."

I picked **arpeggios** for the right hand specifically because they're expressive *and* structured. A free-pitch melody surface would let you play wrong notes; a single triggered loop would feel too fixed. Arpeggios sit in the middle: the notes are constrained by the chord, but speed and timing are yours.

## Technical stack and state

- **Vite + Vanilla JS** (no React). The app is small enough that a framework was overhead, and avoiding React kept the audio loop tight and predictable.
- **MediaPipe Tasks Vision** loaded from CDN, with the WASM runtime.
- **Tone.js** for everything sound-related.
- **Modules:** `handTracking.js` (MediaPipe + per-hand state), `audioEngine.js` (drum synths + transport), `sequencer.js` (Create Mode grid + tempo), `performanceMode.js` (chord/arp + tutorial), `freestyle.js` (a third mode I added — a 4-bar rhyme grid with a bouncing ball, for freestyle rap practice over your beat), and `main.js` as the entry that wires modes together.
- **State** is plain JS objects passed between modules. Mode state (`mode-create` / `mode-performance` / etc.) is reflected as a class on `<body>` so CSS can adapt the layout per mode.
- **Tutorial progress** and "first run" flags persist in `localStorage`, so the intro overlay only fires once per browser.

### Mapping gestures to sound parameters

The full pipeline for a single frame, in plain English:

1. MediaPipe returns 21 landmarks per visible hand.
2. `handTracking.js` extracts cursor (fingertip), pinch state, and spread per hand, smooths the cursor with EMA, applies pinch hysteresis.
3. It emits a `{ left, right }` frame at video framerate (~30fps).
4. The active mode's `handFrame` handler reads what's needed: Create Mode looks at cursor + left pinch; Performance Mode looks at left cursor + left spread + right cursor + right spread.
5. UI elements update via direct DOM manipulation (`elementFromPoint`, classes for `.aimed`, fill bars for hover-dwell).
6. Audio parameters update via Tone.js `.rampTo()` calls so changes glide instead of stepping (a sudden cutoff jump sounds like a click).

Two hands, two synth chains, one frame loop. The whole thing fits in ~4000 lines of JS.

### Challenges and what I solved

- **False pinches** at the threshold — fixed with hysteresis.
- **Cursor jitter** — fixed with EMA smoothing.
- **Both-hands ambiguity** in Create Mode — fixed by making roles strict (right = aim, left = place, no overlap).
- **People not understanding gestures fast enough** — fixed with hover-dwell as a parallel input path, role labels always visible, and a staged tutorial.
- **Audio clicks on parameter changes** — fixed with `rampTo()` instead of `set()` for any continuously-mapped value.
- **Demos failing because audio context wasn't unlocked** — fixed with a "tap to start" gate that calls `Tone.start()` on first user interaction, since browsers won't let you make sound until then.

## Key design decisions, in one place

1. **Pivot from physical to digital, but keep tactility through gesture.** The whole project is bent around this one principle.
2. **Two-handed roles, never overlapping.** Right aims, left places. Left chords, right arpeggios. The system never has to guess intent.
3. **Hover-dwell as a parallel input.** Gestures for the experience, dwell as a safety net. Nobody gets stuck.
4. **Continuous spread, not binary.** Pinch is a switch; spread is a knob. Mapping it to multiple parameters at once (volume + filter + reverb + bass gate) makes a single gesture feel rich.
5. **Hard-coded musical key, free expression inside it.** The user can't play wrong notes, but everything they do feels like a choice.
6. **Staged tutorials, persistent labels.** First-run onboarding *plus* always-visible reminders, because the gestures aren't yet anyone's muscle memory.

## Reflection

**What worked:** The pinch-to-place metaphor genuinely transferred from the physical concept — people get it within a minute or two and start enjoying it. The chord-spread interaction is the favorite part of every demo; watching someone realize they can *open* a chord by opening their hand always lands. And the in-key constraint means even total non-musicians produce something that sounds musical, which is what makes it demo-friendly.

**What was harder than expected:** Hand tracking is reliable *most* of the time, which is the worst kind of reliable — it means the 5% of failures feel like the system is broken even when it's mostly working. Threshold tuning (pinch, spread, hover-dwell timing) ate a lot of iterations, and the right values aren't universal — small hands, dim lighting, and dark sleeves all need different tuning.

**What I'd improve next:**
- **Per-user calibration** — a 5-second "show me your open and closed hand" step at the start to set thresholds for that specific user.
- **Richer sound design** — the synthesized drums are functional but generic; sample-based kits would lift the audio from "fine" to "good."
- **More chord palettes** — the 4-chord vocabulary is intentionally simple, but a "minor key" or "modal" preset would give returning users somewhere to go.
- **Multiplayer** — two users on two webcams sharing one beat would lean back into the social, demo-table vibe of the original physical idea.
- **Latency budget** — there's ~80–120ms total from finger motion to audio output (camera → MediaPipe → audio engine). Most people don't notice, but for tighter rhythm play it'd be worth profiling.

The bigger lesson: when you pivot a project, the *constraint* the original idea was solving for is more important than the form. The blocks were never the point — the feeling of physically making music was. Once I held onto that, the digital version stopped feeling like a downgrade and started feeling like its own thing.
