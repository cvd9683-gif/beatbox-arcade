// Performance Mode (Experimental) — v11
// ==================================================================
// 2026-05-01 fix-pass: hitbox alignment + harmony power + full tutorial.
//
//   - Hit detection now uses getBoundingClientRect() on the chord grid
//     and the arp zones, mapping the cursor pixel into LOCAL [0,1]
//     coordinates. What you see = what activates. No more drift caused
//     by stage padding / webcam gutter / surface gaps.
//
//   - Full intro tutorial — bigger modal-style card with 8 bulleted
//     sections, reopenable from a clearly-labeled "? HOW TO PLAY"
//     button in the top transport row. Mini contextual tutorials
//     stay as toasts.
//
//   - Left hand now drives THREE audio params off `leftSwell`:
//       padBus volume     (existing)
//       padFilter cutoff  (800 Hz closed → 5000 Hz spread)
//       padReverbSend     (0.20 closed → 0.70 spread)
//     plus a NEW bass MonoSynth that attacks at `leftSwell > 0.30`,
//     plays the chord root, and releases below 0.25. Hysteresis
//     prevents flicker. Chord change while bass is active retriggers
//     with the new root.

import * as Tone from 'tone';

const MOODS = [
  { id: 'dark',   label: 'Dark',   chordLabel: 'Am', color: '#ff5cf3', chord: ['A2','C3','E3','A3'], root: 'A1', scale: ['A3','C4','D4','E4','G4','A4','C5','D5','E5'] },
  { id: 'dreamy', label: 'Dreamy', chordLabel: 'F',  color: '#5ce8ff', chord: ['F2','A2','C3','E3'], root: 'F1', scale: ['F3','A3','C4','E4','F4','A4','C5','E5','F5'] },
  { id: 'bright', label: 'Bright', chordLabel: 'C',  color: '#ffe14d', chord: ['C3','E3','G3','C4'], root: 'C2', scale: ['C4','D4','E4','G4','A4','C5','D5','E5','G5'] },
  { id: 'lifted', label: 'Lifted', chordLabel: 'G',  color: '#7cff7c', chord: ['G2','C3','D3','G3'], root: 'G1', scale: ['G3','A3','C4','D4','G4','A4','C5','D5','E5'] },
];

const ARP_ZONES = [
  { id: 'bright',   label: 'Bright',   sub: 'Sparkle',  color: '#ffe14d', register: 'bright',   pattern: 'sparkle' },
  { id: 'balanced', label: 'Balanced', sub: 'Bounce',   color: '#5ce8ff', register: 'balanced', pattern: 'bounce'  },
  { id: 'warm',     label: 'Warm',     sub: 'Slow / Up',color: '#ff5cf3', register: 'warm',     pattern: 'up'      },
];

// Step-by-step Performance Mode onboarding — 4 cards: a centered welcome
// modal, then 3 popovers anchored to the part of the surface each one
// teaches. Auto-advances when the user actually performs the action
// (chord swell crosses 0.3, arp spread crosses 0.3); the transport step
// is the only one that requires a manual Got It because there's no
// "performed" signal for it. The "? HOW TO PLAY" button restarts at
// the welcome step so the user can review the full flow.
const PERF_STEP_THRESHOLD = 0.30;

const PATTERNS = {
  up:     [0, 1, 2, 3, 0, 1, 2, 3],
  bounce: [0, 1, 2, 3, 2, 1, 0, 1],
};
const REGISTER_SHIFT = { warm: 0, balanced: 12, bright: 24 };

const SWELL_FLOOR_DB = -28;
const SWELL_PEAK_DB  = -3;

// Pad filter sweep range driven by leftSwell.
const PAD_CUTOFF_LOW_HZ  = 800;
const PAD_CUTOFF_HIGH_HZ = 5000;

// Pad reverb send range driven by leftSwell.
const PAD_REV_LOW  = 0.20;
const PAD_REV_HIGH = 0.70;

// Bass on/off thresholds (hysteresis).
const BASS_ATTACK_THRESHOLD  = 0.30;
const BASS_RELEASE_THRESHOLD = 0.25;

const ARP_SILENCE_THRESHOLD = 0.15;
const ARP_8TH_THRESHOLD  = 0.40;
const ARP_16TH_THRESHOLD = 0.70;
const HYST = 0.04;

// Generous margin around chord/arp zone bounds in PIXELS for hit detection.
const HIT_MARGIN_PX = 60;

// Pure-CSS animated emoji-hand demos rendered at the top of each
// Performance Mode mini-tutorial card. All animations live in styles.css
// (.spread-demo / .arp-demo / .hover-dwell-demo); pointer-events: none
// so the chord/arp surfaces underneath stay live and the real hand
// cursor (z-index 99999) draws above.
const PERF_GESTURE_DEMOS = {
  spread: `
    <div class="gesture-demo spread-demo" aria-hidden="true">
      <span class="gd-chord">
        <span class="gd-glow"></span>
        <span class="gd-hands">
          <span class="gd-hand gd-hand-pinch">🤏</span>
          <span class="gd-hand gd-hand-spread">🖐️</span>
        </span>
      </span>
    </div>`,
  arp: `
    <div class="gesture-demo arp-demo" aria-hidden="true">
      <span class="gd-arp-zone">
        <i class="gd-note"></i><i class="gd-note"></i>
        <i class="gd-note"></i><i class="gd-note"></i>
      </span>
      <span class="gd-hands">
        <span class="gd-hand gd-hand-pinch">🤏</span>
        <span class="gd-hand gd-hand-spread">🖐️</span>
      </span>
    </div>`,
  hoverDwell: `
    <div class="gesture-demo hover-dwell-demo" aria-hidden="true">
      <span class="gd-button">PAUSE</span>
      <span class="gd-ring"></span>
      <span class="gd-hand">👉</span>
    </div>`,
};

export class PerformanceMode {
  constructor({ root, getBpm, sequencer, ensureAudioStarted, onBack, setActiveInput, setDwellProgress }) {
    this.root = root;
    this.getBpm = getBpm || (() => 100);
    this.sequencer = sequencer;
    this.ensureAudioStarted = ensureAudioStarted || (async () => {});
    this.onBack = onBack || (() => {});
    this.setActiveInput = setActiveInput || (() => {});
    this.setDwellProgress = setDwellProgress || (() => {});

    // Per-side dwell state for top transport + test buttons. Either hand
    // can hover-dwell a [data-hand-dwell] button — whichever is over it
    // drives that side's cursor ring. Pinch-trigger on the same target
    // fires immediately. Per-button cooldown prevents double-fire when
    // the cursor is parked on the button after a click.
    this._dwell = {
      left:  { btn: null, startedAt: 0 },
      right: { btn: null, startedAt: 0 },
    };
    this._dwellCooldownUntil = new WeakMap();

    this.active = false;
    this.audioReady = false;

    this.activeChordIdx = null;
    this.activeArpIdx = null;

    this.leftSwell = 0; this.leftSwellTarget = 0;
    this.rightSpeed = 0; this.rightSpeedTarget = 0;

    this.rightPattern = 'up';
    this.rightRegister = 'balanced';

    this._stepCounter = 0;
    this._arpStepCounter = 0;

    this._currentTutorialKey = null;
    this._sliderTutorialShown = false;

    // Staged onboarding — gates which side of the UI is live + which
    // transport buttons are visible. Driven by the tutorial Next/Back/
    // Finish buttons and by the topbar Restart Tutorial button.
    //   'harmony' → only left side, transport hidden
    //   'arp'     → only right side, transport hidden
    //   'full'    → both sides, full transport
    //   'idle'    → onboarding finished/skipped, full UI live
    this._stage = 'idle';

    this.audioState = {
      isPlaying: true,
      isMuted: false,
      currentChord: null,
      currentPattern: 'up',
      bassActive: false,
      lastChordTriggerTime: 0,
      lastArpTriggerTime: 0,
      lastBassTriggerTime: 0,
    };
  }

  mount() {
    this.root.innerHTML = `
      <div class="performance-stage">
        <header class="perf-top">
          <div class="perf-top-l">
            <span class="perf-tag">EXPERIMENTAL</span>
            <span class="perf-title">Performance Mode</span>
            <span class="perf-subtitle">left = chord · right = arpeggio</span>
          </div>
          <div class="perf-transport" id="perf-transport-row">
            <button id="perf-master"  class="btn-trans master perf-transport-full" type="button" data-hand-dwell title="Master Play / Pause">▶ MASTER</button>
            <button id="perf-beat"    class="btn-trans perf-transport-full" type="button" data-hand-dwell title="Beat Play / Pause">▶ BEAT</button>
            <button id="perf-harmony" class="btn-trans perf-transport-full" type="button" data-hand-dwell title="Harmony Play / Pause">▶ HARMONY</button>
            <button id="perf-restart" class="btn-trans perf-transport-full" type="button" data-hand-dwell title="Restart loop">↻</button>
            <button id="perf-help"    class="btn-trans help wide" type="button" data-hand-dwell title="Restart the staged tutorial">↻ RESTART TUTORIAL</button>
            <button id="perf-back"    class="btn-trans back" type="button" data-hand-dwell title="Back to Create Mode">← CREATE</button>
          </div>
          <div class="perf-armed-chip">
            <span class="perf-armed-key">ACTIVE</span>
            <span class="perf-armed-val" id="perf-armed-val">—</span>
          </div>
        </header>

        <div class="perf-surface">
          <section class="perf-half perf-half-left">
            <span class="perf-half-locked-badge">Unlocks in stage 3</span>
            <div class="perf-half-head">
              <div class="ph-eyebrow">LEFT HAND</div>
              <h2 class="ph-heading">Open the chord</h2>
              <p class="ph-instruction">Move your <strong>left hand</strong> over a chord. <strong>Spread your fingers</strong> to open it — louder, wider, with bass past halfway.</p>
            </div>
            <div class="perf-chord-grid" id="perf-chord-grid">
              ${MOODS.map((m, i) => `
                <button type="button" class="perf-pad" data-idx="${i}" style="--zone-color:${m.color}">
                  <div class="pad-fill"></div>
                  <span class="pp-num">${i + 1}</span>
                  <span class="pp-chord">${m.chordLabel}</span>
                  <span class="pp-mood">${m.label}</span>
                </button>
              `).join('')}
            </div>

            <!-- Big harmony status label — updates as the chord opens. -->
            <div class="perf-harmony-label" id="perf-harmony-label">
              <span class="ph-state" id="ph-state-text">Move your left hand over a chord</span>
              <span class="ph-mood" id="ph-mood-text">—</span>
            </div>

            <div class="hand-meter left">
              <div class="hm-head">
                <span class="hm-label">CHORD SWELL</span>
                <span class="hm-val" id="left-meter-val">—</span>
              </div>
              <div class="hm-track"><div class="hm-fill" id="left-meter-fill"></div></div>
              <div class="hm-stops"><span>closed · soft · dry</span><span>spread · loud · wide</span></div>
            </div>
          </section>

          <section class="perf-half perf-half-right">
            <span class="perf-half-locked-badge">Unlocks in stage 2</span>
            <div class="perf-half-head">
              <div class="ph-eyebrow">RIGHT HAND</div>
              <h2 class="ph-heading">Shape the arpeggio</h2>
              <p class="ph-instruction">Move your <strong>right hand</strong> over a phrase zone. <strong>Spread your fingers</strong> to speed it up.</p>
            </div>
            <div class="perf-arp-zones" id="perf-arp-zones">
              ${ARP_ZONES.map((z, i) => `
                <button type="button" class="arp-zone" data-idx="${i}" style="--zone-color:${z.color}">
                  <div class="az-fill"></div>
                  <span class="az-key">${z.label.toUpperCase()}</span>
                  <span class="az-pattern">${z.sub}</span>
                </button>
              `).join('')}
            </div>
            <div class="hand-meter right">
              <div class="hm-head">
                <span class="hm-label">ARPEGGIO SPEED</span>
                <span class="hm-val" id="right-meter-val">—</span>
              </div>
              <div class="hm-track"><div class="hm-fill" id="right-meter-fill"></div></div>
              <div class="hm-stops"><span>closed · slow</span><span>spread · fast</span></div>
            </div>
          </section>
        </div>

        <footer class="perf-bottom">
          <div class="perf-status-row">
            <span class="ps-status-key">STATUS</span>
            <span class="ps-status-val" id="ps-status">Ready · move your left hand over a chord</span>
          </div>

          <div class="perf-test-row">
            <button id="perf-test"     class="btn-test"     type="button" data-hand-dwell>⚡ TEST CHORD</button>
            <button id="perf-test-arp" class="btn-test-arp" type="button" data-hand-dwell>⚡ TEST ARP</button>
            <button id="perf-stop-all" class="btn-stop-all" type="button" data-hand-dwell>⏹ STOP ALL</button>
            <span class="test-hint">Test buttons play directly · Stop All cuts pad + arp + bass.</span>
          </div>

          <div class="perf-debug" id="perf-debug">
            <div class="dbg-row"><span class="dbg-key">L</span><span>pos <b id="dbg-l-pos">—</b></span><span>zone <b id="dbg-l-zone">—</b></span><span>spread <b id="dbg-l-dist">—</b></span></div>
            <div class="dbg-row"><span class="dbg-key">R</span><span>pos <b id="dbg-r-pos">—</b></span><span>zone <b id="dbg-r-zone">—</b></span><span>spread <b id="dbg-r-dist">—</b></span></div>
            <div class="dbg-row"><span class="dbg-key">RECT</span><span>chord <b id="dbg-chord-bounds">—</b></span><span>arp <b id="dbg-arp-bounds">—</b></span></div>
          </div>

          <div class="perf-debug dbg-engine" id="perf-debug-engine">
            <div class="dbg-row"><span class="dbg-key">CTX</span><b id="dbg-ctx">—</b><span class="dbg-key">MASTER</span><b id="dbg-master">—</b><span class="dbg-key">BEAT</span><b id="dbg-beat">—</b><span class="dbg-key">HARMONY</span><b id="dbg-harm">—</b><span class="dbg-key">BASS</span><b id="dbg-bass">—</b></div>
            <div class="dbg-row"><span class="dbg-key">CHORD</span><b id="dbg-chord">—</b><span class="dbg-key">PATTERN</span><b id="dbg-pat">—</b><span class="dbg-key">CUTOFF</span><b id="dbg-cutoff">—</b><span class="dbg-key">REVERB</span><b id="dbg-rev">—</b></div>
          </div>
        </footer>

        <!-- Inner HTML is rendered by _showTutorial() each time. -->
        <div class="perf-tutorial" id="perf-tutorial" style="display:none"></div>
      </div>
    `;

    this.padEls         = Array.from(this.root.querySelectorAll('.perf-pad'));
    this.arpZoneEls     = Array.from(this.root.querySelectorAll('.arp-zone'));
    this.chordGridEl    = this.root.querySelector('#perf-chord-grid');
    this.arpZonesEl     = this.root.querySelector('#perf-arp-zones');
    this.armedValEl     = this.root.querySelector('#perf-armed-val');
    this.leftMeterFill  = this.root.querySelector('#left-meter-fill');
    this.leftMeterVal   = this.root.querySelector('#left-meter-val');
    this.rightMeterFill = this.root.querySelector('#right-meter-fill');
    this.rightMeterVal  = this.root.querySelector('#right-meter-val');
    this.psStatusEl     = this.root.querySelector('#ps-status');
    this.harmonyLabelEl = this.root.querySelector('#perf-harmony-label');
    this.harmonyStateEl = this.root.querySelector('#ph-state-text');
    this.harmonyMoodEl  = this.root.querySelector('#ph-mood-text');
    this.masterBtn      = this.root.querySelector('#perf-master');
    this.beatBtn        = this.root.querySelector('#perf-beat');
    this.harmonyBtn     = this.root.querySelector('#perf-harmony');
    this.restartBtn     = this.root.querySelector('#perf-restart');
    this.helpBtn        = this.root.querySelector('#perf-help');
    this.backBtn        = this.root.querySelector('#perf-back');
    this.testBtn        = this.root.querySelector('#perf-test');
    this.testArpBtn     = this.root.querySelector('#perf-test-arp');
    this.stopAllBtn     = this.root.querySelector('#perf-stop-all');
    this.tutEl          = this.root.querySelector('#perf-tutorial');
    this.dbg = {
      lPos:  this.root.querySelector('#dbg-l-pos'),
      lZone: this.root.querySelector('#dbg-l-zone'),
      lDist: this.root.querySelector('#dbg-l-dist'),
      rPos:  this.root.querySelector('#dbg-r-pos'),
      rZone: this.root.querySelector('#dbg-r-zone'),
      rDist: this.root.querySelector('#dbg-r-dist'),
      chordBounds: this.root.querySelector('#dbg-chord-bounds'),
      arpBounds:   this.root.querySelector('#dbg-arp-bounds'),
      ctx:    this.root.querySelector('#dbg-ctx'),
      master: this.root.querySelector('#dbg-master'),
      beat:   this.root.querySelector('#dbg-beat'),
      harm:   this.root.querySelector('#dbg-harm'),
      bass:   this.root.querySelector('#dbg-bass'),
      chord:  this.root.querySelector('#dbg-chord'),
      pat:    this.root.querySelector('#dbg-pat'),
      cutoff: this.root.querySelector('#dbg-cutoff'),
      rev:    this.root.querySelector('#dbg-rev'),
    };

    this.backBtn.addEventListener('click', () => this.onBack());
    this.masterBtn.addEventListener('click', () => this._toggleMaster());
    this.beatBtn.addEventListener('click', () => this._toggleBeat());
    this.harmonyBtn.addEventListener('click', () => this._toggleHarmony());
    this.restartBtn.addEventListener('click', () => this._restartLoop());
    this.helpBtn.addEventListener('click', () => this._startStagedTutorial());
    this.testBtn.addEventListener('click', () => this._testChord());
    this.testArpBtn.addEventListener('click', () => this._testArp());
    this.stopAllBtn.addEventListener('click', () => this.stopAllPerformanceAudio());
    // The dismiss button is rebuilt each time _showTutorial runs, so its
    // listener is wired in there — no static binding needed here.
  }

  // ====================================================================
  // PERFORMANCE AUDIO ENGINE
  // ====================================================================

  _initAudio() {
    if (this.audioReady) return;
    console.log('[PerfAudio] _initAudio · creating synths');

    this.master = new Tone.Volume(-1).toDestination();
    this.reverb = new Tone.Reverb({ decay: 4.5, wet: 1.0 }).connect(this.master);

    // ----- Pad chain -----
    this.padBus = new Tone.Volume(SWELL_FLOOR_DB);
    this.padFilter = new Tone.Filter(PAD_CUTOFF_LOW_HZ, 'lowpass');
    this.padDry = new Tone.Gain(0.7).connect(this.master);
    this.padReverbSend = new Tone.Gain(PAD_REV_LOW).connect(this.reverb);
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsine', count: 3, spread: 18 },
      envelope:   { attack: 1.2, decay: 0.9, sustain: 0.85, release: 2.2 },
    });
    this.pad.volume.value = -4;
    this.pad.connect(this.padBus);
    this.padBus.connect(this.padFilter);
    this.padFilter.connect(this.padDry);
    this.padFilter.connect(this.padReverbSend);

    // ----- Arp chain (PolySynth so each scheduled note gets its own voice). -----
    this.arpDelay = new Tone.FeedbackDelay({
      delayTime: '8n', feedback: 0.30, wet: 0.45,
    }).connect(this.master);
    this.arpReverbSend = new Tone.Gain(0.55).connect(this.reverb);
    this.arpSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope:   { attack: 0.005, decay: 0.18, sustain: 0.0, release: 0.45 },
    });
    this.arpSynth.volume.value = -6;
    this.arpSynth.connect(this.master);
    this.arpSynth.connect(this.arpDelay);
    this.arpSynth.connect(this.arpReverbSend);

    // ----- Bass chain (NEW v11). Triggered by left swell crossing
    // BASS_ATTACK_THRESHOLD; released below BASS_RELEASE_THRESHOLD. -----
    this.bassBus = new Tone.Volume(-2).connect(this.master);
    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter:        { Q: 2, type: 'lowpass', rolloff: -24 },
      envelope:      { attack: 0.05, decay: 0.40, sustain: 0.65, release: 1.20 },
      filterEnvelope:{ attack: 0.05, decay: 0.30, sustain: 0.50, release: 0.80,
                       baseFrequency: 80, octaves: 2.5 },
    });
    this.bass.volume.value = -4;
    this.bass.connect(this.bassBus);

    this.audioReady = true;
    console.log('[PerfAudio] ready · pad sustained-attack · arp PolySynth · bass MonoSynth · ctx:', Tone.context.state);
  }

  async _ensureRunning() {
    await this.ensureAudioStarted();
    if (Tone.context.state !== 'running') {
      try { await Tone.start(); console.log('[PerfAudio] Tone.start() forced · ctx:', Tone.context.state); }
      catch (e) { console.warn('[PerfAudio] Tone.start() failed:', e); }
    }
  }

  _retriggerPad() {
    if (!this.audioReady) return;
    if (this.activeChordIdx == null || this.audioState.isMuted) return;
    const m = MOODS[this.activeChordIdx];
    try { this.pad.releaseAll(); } catch {}
    this.pad.triggerAttack(m.chord);
    this.audioState.currentChord = m.chordLabel;
    this.audioState.lastChordTriggerTime = performance.now();
    console.log('[PerfAudio] pad attack (sustained):', m.chordLabel);
    this._pulsePad(this.activeChordIdx);
  }

  _attackBass() {
    if (!this.audioReady || this.activeChordIdx == null || this.audioState.isMuted) return;
    const m = MOODS[this.activeChordIdx];
    // MonoSynth uses triggerRelease (PolySynth-only releaseAll() silently
    // failed here, which is why bass kept sustaining after master pause).
    try { this.bass.triggerRelease(); } catch {}
    this.bass.triggerAttack(m.root);
    this.audioState.bassActive = true;
    this.audioState.lastBassTriggerTime = performance.now();
    console.log('[PerfAudio] bass attack:', m.root);
  }

  _releaseBass() {
    if (!this.audioReady) return;
    try { this.bass.triggerRelease(); } catch {}
    this.audioState.bassActive = false;
    console.log('[PerfAudio] bass release');
  }

  _playArpNote(time) {
    if (!this.audioReady) return;
    const note = this._pickArpNote();
    if (!note) return;
    try {
      this.arpSynth.triggerAttackRelease(note, '16n', time);
      this.audioState.lastArpTriggerTime = performance.now();
      this._arpStepCounter++;
      if ((this._arpStepCounter % 4) === 1) {
        console.log('[PerfAudio] arp →', note, '· pat:', this.rightPattern, '· reg:', this.rightRegister, '· speed:', this.rightSpeed.toFixed(2));
      }
    } catch (e) {
      console.warn('[PerfAudio] arp trigger failed:', e);
    }
  }

  _pickArpNote() {
    const idx = this.activeChordIdx != null ? this.activeChordIdx : 0;
    const mood = MOODS[idx];
    const shift = REGISTER_SHIFT[this.rightRegister] ?? 12;
    let baseNote;
    if (this.rightPattern === 'sparkle') {
      baseNote = mood.scale[Math.floor(Math.random() * mood.scale.length)];
    } else {
      const pat = PATTERNS[this.rightPattern] || PATTERNS.up;
      const i = pat[this._arpStepCounter % pat.length] % mood.chord.length;
      baseNote = mood.chord[i];
    }
    try { return Tone.Frequency(baseNote).transpose(shift).toNote(); }
    catch { return baseNote; }
  }

  stopAllPerformanceAudio() {
    console.log('[PerfAudio] stopAllPerformanceAudio()');
    try { this.pad?.releaseAll(); } catch {}
    try { this.arpSynth?.releaseAll(); } catch {}
    try { this.bass?.triggerRelease(); } catch {}
    if (this.padBus) this.padBus.volume.rampTo(SWELL_FLOOR_DB, 0.25);
    this.audioState.isMuted = true;
    this.audioState.bassActive = false;
    this.audioState.currentChord = null;
    this._updateAllButtons();
    this._setStatus('All performance audio stopped · pad + arp + bass silenced');
  }

  // ====================================================================
  // Lifecycle
  // ====================================================================
  async start() {
    console.log('[Perf] start()');
    await this._ensureRunning();
    this._initAudio();
    this.active = true;
    this.sequencer?.ensurePlaying?.();
    this.activeChordIdx = null;
    this.activeArpIdx = 1;
    this.audioState.isMuted = false;
    this.audioState.isPlaying = true;
    this.audioState.bassActive = false;
    this.audioState.currentChord = null;
    this.audioState.currentPattern = ARP_ZONES[1].pattern;
    this.audioState.lastChordTriggerTime = 0;
    this.audioState.lastArpTriggerTime = 0;
    this.audioState.lastBassTriggerTime = 0;
    this.leftSwell = 0; this.leftSwellTarget = 0;
    this.rightSpeed = 0; this.rightSpeedTarget = 0;
    this._stepCounter = 0; this._arpStepCounter = 0;
    this.rightPattern  = ARP_ZONES[1].pattern;
    this.rightRegister = ARP_ZONES[1].register;
    this._sliderTutorialShown = false;
    this._renderActive();
    this._renderArpZone();
    this._setStatus('Move your left hand over a chord. Right hand for arpeggios.');
    this._updateAllButtons();
    // Staged onboarding the first time the user enters Performance Mode
    // this session. main.js clears localStorage on every refresh, so it
    // always reappears for the demo. The Restart Tutorial button always
    // re-enters the flow regardless of the seen flag.
    let introSeen = false;
    try { introSeen = localStorage.getItem('perfMode.tut.intro.v1') === '1'; } catch {}
    if (introSeen) this._setStage('idle');
    else this._startStagedTutorial();
  }

  // Apply a stage class to the performance-stage container — drives all
  // the dim/hide CSS. Also stored as this._stage for the handFrame gate.
  _setStage(stage) {
    this._stage = stage;
    const stageEl = this.root.querySelector('.performance-stage');
    if (!stageEl) return;
    stageEl.classList.remove('stage-harmony', 'stage-arp', 'stage-full', 'stage-idle');
    stageEl.classList.add(`stage-${stage}`);
  }

  _startStagedTutorial() {
    // Dismiss any open tutorial first so the staged flow always wins.
    if (this.tutEl) this.tutEl.style.display = 'none';
    this._currentTutorialKey = null;
    this._setStage('harmony');
    this._showTutorial('intro');
  }

  stop() {
    console.log('[Perf] stop()');
    this.active = false;
    this.stopAllPerformanceAudio();
    this.padEls?.forEach((el) => el.classList.remove('hover', 'active'));
    this.arpZoneEls?.forEach((el) => el.classList.remove('hover', 'active'));
    this._dismissTutorial(false);
  }

  // ====================================================================
  // Tutorials — guided 4-step onboarding
  // ====================================================================
  _showTutorial(key = 'intro') {
    if (!this.tutEl) return;
    this._currentTutorialKey = key;
    if (key === 'intro')           this._renderIntro();
    else if (key === 'harmony')    this._renderStageHarmony();
    else if (key === 'arp')        this._renderStageArp();
    else if (key === 'full')       this._renderStageFull();
    this.tutEl.style.display = 'flex';
    console.log('[Perf] tutorial →', key, '· stage', this._stage);
  }

  _renderIntro() {
    this.tutEl.innerHTML = `
      <div class="intro-card welcome-card perf-intro-card">
        <div class="intro-eyebrow">PERFORMANCE MODE</div>
        <h1 class="intro-title">Perform your beat like a song</h1>
        <p class="intro-subtitle">Three stages: harmony first, then arpeggio, then the full instrument. Each stage unlocks the next.</p>
        <div class="welcome-actions">
          <button class="btn big" type="button" data-hand-dwell data-tutorial-dismiss data-perf-step="skip-all" data-dwell-ms="1800">SKIP TUTORIAL</button>
          <button class="btn primary big" type="button" data-hand-dwell data-tutorial-dismiss data-perf-step="next" data-dwell-ms="1500">START GUIDED TUTORIAL</button>
        </div>
      </div>
    `;
    this.tutEl.className = 'perf-tutorial is-modal anchor-center';
    this._wireStepButtons();
  }

  _renderStageHarmony() {
    this._setStage('harmony');
    this.tutEl.innerHTML = this._stepCardHTML({
      eyebrow: 'STAGE 1 OF 3 · LEFT HAND ONLY',
      title: 'Step 1: Open the harmony',
      body: 'Move your <strong>LEFT hand</strong> over a chord. <strong>Spread your thumb and index finger</strong> to make the chord swell.',
      demo: PERF_GESTURE_DEMOS.spread,
      back: false,
      nextLabel: 'NEXT',
    });
    this.tutEl.className = 'perf-tutorial is-popover anchor-left';
    this._wireStepButtons();
  }

  _renderStageArp() {
    this._setStage('arp');
    this.tutEl.innerHTML = this._stepCardHTML({
      eyebrow: 'STAGE 2 OF 3 · RIGHT HAND ONLY',
      title: 'Step 2: Shape the arpeggio',
      body: 'Move your <strong>RIGHT hand</strong> over a phrase zone. <strong>Spread your thumb and index finger</strong> to speed it up.',
      demo: PERF_GESTURE_DEMOS.arp,
      back: true,
      nextLabel: 'NEXT',
    });
    this.tutEl.className = 'perf-tutorial is-popover anchor-right';
    this._wireStepButtons();
  }

  _renderStageFull() {
    this._setStage('full');
    this.tutEl.innerHTML = this._stepCardHTML({
      eyebrow: 'STAGE 3 OF 3 · FULL INSTRUMENT',
      title: 'Step 3: Put it together',
      body: 'Left hand opens the chords. Right hand shapes the arpeggio. Use the <strong>top controls</strong> to pause or restart the song.',
      demo: PERF_GESTURE_DEMOS.hoverDwell,
      back: true,
      nextLabel: 'FINISH TUTORIAL',
    });
    this.tutEl.className = 'perf-tutorial is-popover anchor-top';
    this._wireStepButtons();
  }

  _stepCardHTML({ eyebrow, title, body, demo, back = false, nextLabel = 'NEXT' }) {
    const backBtn = back
      ? `<button class="btn" type="button" data-hand-dwell data-tutorial-dismiss data-perf-step="back" data-dwell-ms="1500">BACK</button>`
      : '';
    return `
      <div class="onboard-card perf-step-card">
        ${demo || ''}
        <div class="onboard-eyebrow">${eyebrow}</div>
        <div class="onboard-title">${title}</div>
        <div class="onboard-body">${body}</div>
        <div class="try-it-now"><span class="tin-pulse"></span>Try it now — the tutorial stays open</div>
        <div class="onboard-actions">
          <button class="btn" type="button" data-hand-dwell data-tutorial-dismiss data-perf-step="skip-all" data-dwell-ms="1800">SKIP TUTORIAL</button>
          ${backBtn}
          <button class="btn primary" type="button" data-hand-dwell data-tutorial-dismiss data-perf-step="next" data-dwell-ms="1500">${nextLabel}</button>
        </div>
      </div>
    `;
  }

  _wireStepButtons() {
    this.tutEl.querySelector('[data-perf-step="skip-all"]')
        ?.addEventListener('click', () => this._finishStagedTutorial(true));
    this.tutEl.querySelector('[data-perf-step="next"]')
        ?.addEventListener('click', () => this._advanceTutorial());
    this.tutEl.querySelector('[data-perf-step="back"]')
        ?.addEventListener('click', () => this._backTutorial());
  }

  _advanceTutorial() {
    const order = ['intro', 'harmony', 'arp', 'full'];
    const idx = order.indexOf(this._currentTutorialKey);
    const next = order[idx + 1];
    if (!next) {
      // Past the last stage — finish + reveal full UI.
      this._finishStagedTutorial(true);
      return;
    }
    this._showTutorial(next);
  }

  _backTutorial() {
    const order = ['intro', 'harmony', 'arp', 'full'];
    const idx = order.indexOf(this._currentTutorialKey);
    const prev = order[idx - 1];
    if (!prev || prev === 'intro') {
      // Going back from harmony goes to the intro modal.
      this._showTutorial('intro');
      this._setStage('harmony');   // intro modal: keep harmony staged
      return;
    }
    this._showTutorial(prev);
  }

  _finishStagedTutorial(persist = true) {
    this._setStage('idle');
    this._dismissTutorial(persist);
  }

  // Auto-advance was disabled after testing: chord/arp steps were
  // closing the moment a user crossed the swell/speed threshold while
  // exploring, which felt like the tutorial was "skipping itself."
  // The user must now hover GOT IT to advance — same as Create Mode —
  // so they can actually read each card and try the gesture multiple
  // times if they want. No-op kept so call sites don't need to change.
  _maybeAutoAdvanceTutorial() { /* intentionally disabled */ }

  _dismissTutorial(persist = true) {
    if (!this.tutEl) return;
    const key = this._currentTutorialKey;
    this.tutEl.style.display = 'none';
    if (persist && key) {
      const storageKey = `perfMode.tut.${key}.v1`;
      try { localStorage.setItem(storageKey, '1'); } catch {}
    }
    this._currentTutorialKey = null;
  }

  // ====================================================================
  // Transport
  // ====================================================================
  async _toggleMaster() {
    await this._ensureRunning();
    if (this.audioState.isPlaying) {
      this.audioState.isPlaying = false;
      this.sequencer?.stop?.();
      this.audioState.isMuted = true;
      try { this.pad?.releaseAll(); } catch {}
      try { this.arpSynth?.releaseAll(); } catch {}
      this._releaseBass();
      console.log('[Perf] master · paused'); this._setStatus('Master paused');
    } else {
      this.audioState.isPlaying = true;
      this.sequencer?.ensurePlaying?.();
      this.audioState.isMuted = false;
      if (this.activeChordIdx != null) this._retriggerPad();
      console.log('[Perf] master · playing'); this._setStatus('Master playing');
    }
    this._updateAllButtons();
  }
  async _toggleBeat() {
    await this._ensureRunning();
    if (Tone.Transport.state === 'started') {
      this.sequencer?.stop?.();
      console.log('[Perf] beat · paused'); this._setStatus('Beat paused');
    } else {
      this.sequencer?.ensurePlaying?.();
      console.log('[Perf] beat · playing'); this._setStatus('Beat playing');
    }
    this._updateAllButtons();
  }
  _toggleHarmony() {
    this.audioState.isMuted = !this.audioState.isMuted;
    if (this.audioState.isMuted) {
      try { this.pad?.releaseAll(); } catch {}
      this._releaseBass();
      console.log('[Perf] harmony · muted'); this._setStatus('Harmony paused · beat continues');
    } else {
      console.log('[Perf] harmony · playing'); this._setStatus('Harmony playing');
      if (this.activeChordIdx != null) this._retriggerPad();
    }
    this._updateAllButtons();
  }
  _restartLoop() {
    Tone.Transport.stop();
    Tone.Transport.position = '0:0:0';
    this.sequencer?.ensurePlaying?.();
    this._stepCounter = 0; this._arpStepCounter = 0;
    console.log('[Perf] loop restarted'); this._setStatus('Loop restarted');
    this._updateAllButtons();
  }

  async _testChord() {
    await this._ensureRunning();
    this._initAudio();
    const idx = this.activeChordIdx != null ? this.activeChordIdx : 0;
    const mood = MOODS[idx];
    console.log('[Perf] TEST chord:', mood.chordLabel, mood.chord);
    if (this.audioState.isMuted) { this.audioState.isMuted = false; this._updateAllButtons(); }
    if (this.padBus) this.padBus.volume.rampTo(-3, 0.05);
    try { this.pad.releaseAll(); } catch {}
    this.pad.triggerAttackRelease(mood.chord, '2n');
    this._pulsePad(idx);
    this.audioState.lastChordTriggerTime = performance.now();
    this.audioState.currentChord = mood.chordLabel;
    this._setStatus(`Test chord · ${mood.chordLabel}`);
  }

  async _testArp() {
    await this._ensureRunning();
    this._initAudio();
    const idx = this.activeChordIdx != null ? this.activeChordIdx : 0;
    const mood = MOODS[idx];
    const pattern = this.rightPattern || 'up';
    const register = this.rightRegister || 'balanced';
    console.log('[Perf] TEST arp · chord:', mood.chordLabel, '· pattern:', pattern, '· register:', register, '· ctx:', Tone.context.state);
    const interval  = 0.15;
    const startTime = Tone.now() + 0.05;
    const shift     = REGISTER_SHIFT[register] ?? 12;
    const patArr    = PATTERNS[pattern] || PATTERNS.up;
    for (let i = 0; i < 8; i++) {
      try {
        let baseNote;
        if (pattern === 'sparkle') baseNote = mood.scale[Math.floor(Math.random() * mood.scale.length)];
        else baseNote = mood.chord[patArr[i % patArr.length] % mood.chord.length];
        const note = Tone.Frequency(baseNote).transpose(shift).toNote();
        this.arpSynth.triggerAttackRelease(note, '16n', startTime + i * interval);
        console.log(`[PerfAudio] TEST arp note ${i + 1}: ${note} @ +${(i * interval).toFixed(2)}s`);
      } catch (e) {
        console.warn(`[PerfAudio] TEST arp note ${i + 1} failed:`, e);
      }
    }
    this.audioState.lastArpTriggerTime = performance.now();
    this._setStatus(`Test arp · ${mood.chordLabel} · ${pattern}`);
  }

  _updateAllButtons() {
    if (this.masterBtn)  this._setBtn(this.masterBtn,  this.audioState.isPlaying ? '❚❚ MASTER'  : '▶ MASTER',  this.audioState.isPlaying);
    if (this.beatBtn) {
      const beating = Tone.Transport.state === 'started';
      this._setBtn(this.beatBtn, beating ? '❚❚ BEAT' : '▶ BEAT', beating);
    }
    if (this.harmonyBtn) this._setBtn(this.harmonyBtn, this.audioState.isMuted ? '▶ HARMONY' : '❚❚ HARMONY', !this.audioState.isMuted);
  }
  _setBtn(btn, text, on) { btn.textContent = text; btn.classList.toggle('on', !!on); }

  // ====================================================================
  // Active chord / arp zone
  // ====================================================================
  _setActiveChord(idx) {
    if (idx === this.activeChordIdx) return;
    this.activeChordIdx = idx;
    if (idx == null) {
      try { this.pad?.releaseAll(); } catch {}
      this._releaseBass();
      this.audioState.currentChord = null;
    } else {
      const m = MOODS[idx];
      console.log('[Perf] active chord →', m.chordLabel);
      this._setStatus(`Active chord · ${m.chordLabel} (${m.label})`);
      this._retriggerPad();
      // If bass is sustaining, swap its root to the new chord too.
      if (this.audioState.bassActive) {
        try { this.bass.triggerRelease(); } catch {}
        this.bass.triggerAttack(m.root);
        this.audioState.lastBassTriggerTime = performance.now();
        console.log('[PerfAudio] bass switch:', m.root);
      }
    }
    this._renderActive();
  }
  _setActiveArpZone(idx) {
    if (idx === this.activeArpIdx) return;
    this.activeArpIdx = idx;
    if (idx != null && ARP_ZONES[idx]) {
      this.rightPattern = ARP_ZONES[idx].pattern;
      this.rightRegister = ARP_ZONES[idx].register;
      this.audioState.currentPattern = this.rightPattern;
      console.log('[Perf] active arp zone →', ARP_ZONES[idx].label, '·', ARP_ZONES[idx].sub);
    }
    this._renderArpZone();
  }

  // ====================================================================
  // Per-step (arpeggio scheduling — pad is sustained, no retrigger)
  // ====================================================================
  onStep(s, time) {
    if (!this.active || !this.audioReady) return;
    this._stepCounter++;
    const speed = this.rightSpeed;
    if (speed < ARP_SILENCE_THRESHOLD) return;
    let trigger = false, scheduleSixteenth = false;
    if (speed >= ARP_16TH_THRESHOLD) { trigger = true; scheduleSixteenth = true; }
    else if (speed >= ARP_8TH_THRESHOLD) { trigger = true; }
    else { trigger = (this._stepCounter % 2 === 0); }
    if (trigger) this._playArpNote(time);
    if (scheduleSixteenth) {
      const sixteenth = Tone.Time('16n').toSeconds();
      Tone.Transport.scheduleOnce((sub) => this._playArpNote(sub), `+${sixteenth}`);
    }
  }
  _pulsePad(idx) {
    const el = this.padEls?.[idx];
    if (!el) return;
    el.classList.remove('playing'); void el.offsetWidth; el.classList.add('playing');
    setTimeout(() => el.classList.remove('playing'), 800);
  }

  // ====================================================================
  // Per-frame routing
  // ====================================================================
  handFrame(data) {
    if (!this.active) return;

    let left = data?.left || null;
    let right = data?.right || null;
    if (left?.cursor && right?.cursor && left.cursor.x > right.cursor.x) {
      const tmp = left; left = right; right = tmp;
    }

    this._updateAllButtons();

    // Top transport + test row: hover-dwell on either hand fires the
    // button. Chord pads / arp zones react to position only and live
    // outside the transport row's pixel area, so dwell co-exists with
    // surface hovering — no need to "claim" a hand here.
    this._tickTransportDwell(left, right);

    // Stage gate: during 'arp' the left side is dimmed/locked, so we
    // skip all left-hand processing — no chord activation, no swell,
    // no audio modulation. 'harmony', 'full', and 'idle' all process
    // the left hand normally.
    const leftActive = this._stage !== 'arp';

    // ---- LEFT HAND: hit detection from grid bounding rect ----
    if (leftActive && left?.cursor) {
      const px = left.cursor.x * window.innerWidth;
      const py = left.cursor.y * window.innerHeight;
      const idx = this._chordIdxFromPixel(px, py);
      this.padEls.forEach((el, i) => el.classList.toggle('hover', i === idx));
      this._setActiveChord(idx);
      const raw = (left.tipRatio !== undefined && left.tipRatio !== null) ? left.tipRatio : 0.2;
      this.leftSwellTarget = Math.max(0, Math.min(1, (raw - 0.2) / 1.0));
    } else {
      this.padEls.forEach((el) => el.classList.remove('hover'));
      this.leftSwellTarget = 0;
      if (this.activeChordIdx != null) this._setActiveChord(null);
    }
    this.leftSwell += (this.leftSwellTarget - this.leftSwell) * 0.10;

    // Apply LEFT-hand triple modulation: volume + filter + reverb send.
    if (this.audioReady) {
      const targetVol = this.audioState.isMuted
        ? -Infinity
        : SWELL_FLOOR_DB + this.leftSwell * (SWELL_PEAK_DB - SWELL_FLOOR_DB);
      this.padBus.volume.rampTo(targetVol, 0.05);

      const targetCutoff = PAD_CUTOFF_LOW_HZ + this.leftSwell * (PAD_CUTOFF_HIGH_HZ - PAD_CUTOFF_LOW_HZ);
      this.padFilter.frequency.rampTo(targetCutoff, 0.06);

      const targetSend = PAD_REV_LOW + this.leftSwell * (PAD_REV_HIGH - PAD_REV_LOW);
      this.padReverbSend.gain.rampTo(targetSend, 0.06);

      // Bass attack/release with hysteresis.
      if (!this.audioState.bassActive
          && this.activeChordIdx != null
          && !this.audioState.isMuted
          && this.leftSwell > BASS_ATTACK_THRESHOLD) {
        this._attackBass();
      } else if (this.audioState.bassActive
                 && (this.leftSwell < BASS_RELEASE_THRESHOLD
                     || this.activeChordIdx == null
                     || this.audioState.isMuted)) {
        this._releaseBass();
      }
    }

    // Stage gate: during 'harmony' the right side is dimmed/locked, so
    // we skip all right-hand processing.
    const rightActive = this._stage !== 'harmony';

    // ---- RIGHT HAND: hit detection from arp zones bounding rect ----
    if (rightActive && right?.cursor) {
      const px = right.cursor.x * window.innerWidth;
      const py = right.cursor.y * window.innerHeight;
      const arpIdx = this._arpZoneFromPixel(px, py);
      this.arpZoneEls.forEach((el, i) => el.classList.toggle('hover', i === arpIdx));
      this._setActiveArpZone(arpIdx);
      const raw = (right.tipRatio !== undefined && right.tipRatio !== null) ? right.tipRatio : 0;
      this.rightSpeedTarget = Math.max(0, Math.min(1, (raw - 0.2) / 1.0));
    } else {
      this.arpZoneEls.forEach((el) => el.classList.remove('hover'));
      this.rightSpeedTarget = 0;
    }
    this.rightSpeed += (this.rightSpeedTarget - this.rightSpeed) * 0.10;

    // Auto-advance the chord/arp tutorial steps when the user actually
    // performs the action (swell or spread crosses 0.3) — feels like
    // the app noticed instead of holding them up with another modal.
    this._maybeAutoAdvanceTutorial();

    this._renderMeters();
    this._renderActiveGlow();
    this._renderHarmonyLabel();
    this._renderDebug(left, right);
    this._renderEngineDebug();
  }

  // -------- Hover-dwell engine for top transport + test row --------
  // 700 ms over a [data-hand-dwell] target fires .click(); pinch-trigger
  // fires immediately. Per-button cooldown stops a parked cursor from
  // re-firing right after activation. Each hand has its own dwell timer
  // so the user can keep their other hand in chord/arp space.
  _tickTransportDwell(left, right) {
    const TRANSPORT_DWELL_MS = 700;
    const TRANSPORT_REFIRE_MS = 600;
    const claimed = { left: false, right: false };

    const tick = (side, hand) => {
      const slot = this._dwell[side];
      if (!hand?.cursor) {
        if (slot.btn) {
          slot.btn.classList.remove('hand-hover');
          slot.btn.style.setProperty('--dwell-fill', '0%');
        }
        slot.btn = null; slot.startedAt = 0;
        this.setDwellProgress(0, side);
        return;
      }
      const x = hand.cursor.x * window.innerWidth;
      const y = hand.cursor.y * window.innerHeight;
      const el = document.elementFromPoint(x, y);
      const btn = el?.closest('[data-hand-dwell]');

      if (!btn || (this._dwellCooldownUntil.get(btn) ?? 0) > performance.now()) {
        if (slot.btn) {
          slot.btn.classList.remove('hand-hover');
          slot.btn.style.setProperty('--dwell-fill', '0%');
        }
        slot.btn = null; slot.startedAt = 0;
        this.setDwellProgress(0, side);
        return;
      }

      // Pinch over a transport button = instant fire.
      if (hand.pinchTriggered) {
        btn.click();
        btn.classList.add('pinch-flash');
        setTimeout(() => btn.classList.remove('pinch-flash'), 250);
        this._dwellCooldownUntil.set(btn, performance.now() + TRANSPORT_REFIRE_MS);
        slot.btn = null; slot.startedAt = 0;
        this.setDwellProgress(0, side);
        claimed[side] = true;
        return;
      }

      if (slot.btn !== btn) {
        if (slot.btn) {
          slot.btn.classList.remove('hand-hover');
          slot.btn.style.setProperty('--dwell-fill', '0%');
        }
        slot.btn = btn;
        slot.startedAt = performance.now();
        btn.classList.add('hand-hover');
      }
      const elapsed = performance.now() - slot.startedAt;
      const pct = Math.min(100, (elapsed / TRANSPORT_DWELL_MS) * 100);
      btn.style.setProperty('--dwell-fill', `${pct}%`);
      this.setDwellProgress(pct, side);
      claimed[side] = true;

      if (elapsed >= TRANSPORT_DWELL_MS) {
        btn.click();
        btn.classList.add('pinch-flash');
        setTimeout(() => btn.classList.remove('pinch-flash'), 250);
        this._dwellCooldownUntil.set(btn, performance.now() + TRANSPORT_REFIRE_MS);
        btn.classList.remove('hand-hover');
        btn.style.setProperty('--dwell-fill', '0%');
        slot.btn = null; slot.startedAt = 0;
        this.setDwellProgress(0, side);
      }
    };

    tick('left', left);
    tick('right', right);
    return claimed;
  }

  // -------- Hit detection from real DOM bounding rects --------
  _chordIdxFromPixel(px, py) {
    if (!this.chordGridEl) return this.activeChordIdx;
    const rect = this.chordGridEl.getBoundingClientRect();
    if (px < rect.left - HIT_MARGIN_PX || px > rect.right + HIT_MARGIN_PX ||
        py < rect.top  - HIT_MARGIN_PX || py > rect.bottom + HIT_MARGIN_PX) {
      return null;
    }
    const localX = Math.max(0, Math.min(1, (px - rect.left) / rect.width));
    const localY = Math.max(0, Math.min(1, (py - rect.top)  / rect.height));
    const cur = this.activeChordIdx;
    let col, row;
    if (cur != null) {
      const curCol = cur % 2;
      if (curCol === 0 && localX > 0.5 + HYST) col = 1;
      else if (curCol === 1 && localX < 0.5 - HYST) col = 0;
      else col = curCol;
      const curRow = Math.floor(cur / 2);
      if (curRow === 0 && localY > 0.5 + HYST) row = 1;
      else if (curRow === 1 && localY < 0.5 - HYST) row = 0;
      else row = curRow;
    } else {
      col = localX < 0.5 ? 0 : 1;
      row = localY < 0.5 ? 0 : 1;
    }
    return row * 2 + col;
  }
  _arpZoneFromPixel(px, py) {
    if (!this.arpZonesEl) return this.activeArpIdx;
    const rect = this.arpZonesEl.getBoundingClientRect();
    if (px < rect.left - HIT_MARGIN_PX || px > rect.right + HIT_MARGIN_PX ||
        py < rect.top  - HIT_MARGIN_PX || py > rect.bottom + HIT_MARGIN_PX) {
      return null;
    }
    const localY = Math.max(0, Math.min(1, (py - rect.top) / rect.height));
    const cur = this.activeArpIdx;
    if (cur != null) {
      if (cur === 0 && localY > 0.34 + HYST) return 1;
      if (cur === 1 && localY < 0.34 - HYST) return 0;
      if (cur === 1 && localY > 0.67 + HYST) return 2;
      if (cur === 2 && localY < 0.67 - HYST) return 1;
      return cur;
    }
    if (localY < 0.34) return 0;
    if (localY < 0.67) return 1;
    return 2;
  }

  // -------- UI render --------
  _renderActive() {
    if (this.armedValEl) {
      if (this.activeChordIdx == null) {
        this.armedValEl.textContent = '—';
        this.armedValEl.style.color = '';
      } else {
        const m = MOODS[this.activeChordIdx];
        this.armedValEl.textContent = `${m.chordLabel} · ${m.label}`;
        this.armedValEl.style.color = m.color;
      }
    }
    this.padEls?.forEach((el, i) => el.classList.toggle('active', i === this.activeChordIdx));
  }
  _renderArpZone() {
    this.arpZoneEls?.forEach((el, i) => el.classList.toggle('active', i === this.activeArpIdx));
  }
  _renderActiveGlow() {
    this.padEls?.forEach((el, i) => {
      const fillEl = el.querySelector('.pad-fill');
      const isActive = (i === this.activeChordIdx);
      const v = isActive ? this.leftSwell : 0;
      el.style.setProperty('--swell', v.toFixed(3));
      if (fillEl) fillEl.style.height = `${(v * 100).toFixed(1)}%`;
    });
    this.arpZoneEls?.forEach((el, i) => {
      const fillEl = el.querySelector('.az-fill');
      const isActive = (i === this.activeArpIdx);
      const v = isActive ? this.rightSpeed : 0;
      el.style.setProperty('--intensity', v.toFixed(3));
      if (fillEl) fillEl.style.width = `${(v * 100).toFixed(1)}%`;
    });
  }
  _renderHarmonyLabel() {
    if (!this.harmonyLabelEl) return;
    const idx = this.activeChordIdx;
    const swell = this.leftSwell;
    let stateText, moodText, glow;

    if (idx == null) {
      stateText = 'Move your left hand over a chord';
      moodText = '—';
      glow = 0;
      this.harmonyLabelEl.style.removeProperty('--label-color');
    } else {
      const m = MOODS[idx];
      moodText = `${m.chordLabel} · ${m.label}`;
      this.harmonyLabelEl.style.setProperty('--label-color', m.color);
      glow = swell;
      if (this.audioState.isMuted)            stateText = 'Harmony muted';
      else if (swell < 0.15)                   stateText = `Holding ${m.chordLabel}`;
      else if (this.audioState.bassActive
               && swell > 0.65)                stateText = 'Harmony Bloom · bass + wide';
      else if (this.audioState.bassActive)     stateText = 'Opening Harmony · bass on';
      else                                     stateText = 'Opening Harmony';
    }
    this.harmonyLabelEl.style.setProperty('--swell', glow.toFixed(3));
    this.harmonyLabelEl.classList.toggle('active', idx != null);
    this.harmonyLabelEl.classList.toggle('bloom', idx != null && swell > 0.5);
    if (this.harmonyStateEl) this.harmonyStateEl.textContent = stateText;
    if (this.harmonyMoodEl)  this.harmonyMoodEl.textContent  = moodText;
  }
  _renderMeters() {
    if (this.leftMeterFill)  this.leftMeterFill.style.width = `${(this.leftSwell * 100).toFixed(1)}%`;
    if (this.leftMeterVal)   this.leftMeterVal.textContent = `${(this.leftSwell * 100).toFixed(0)}%`;
    if (this.rightMeterFill) this.rightMeterFill.style.width = `${(this.rightSpeed * 100).toFixed(1)}%`;
    if (this.rightMeterVal)  this.rightMeterVal.textContent = `${(this.rightSpeed * 100).toFixed(0)}%`;
  }
  _renderDebug(left, right) {
    const fmt = (n) => (n == null ? '—' : n.toFixed(2));
    if (left?.cursor) {
      this.dbg.lPos.textContent  = `${fmt(left.cursor.x)},${fmt(left.cursor.y)}`;
      this.dbg.lZone.textContent = this.activeChordIdx != null ? MOODS[this.activeChordIdx].chordLabel : '—';
      this.dbg.lDist.textContent = fmt(left.tipRatio);
    } else {
      this.dbg.lPos.textContent = '—'; this.dbg.lZone.textContent = '—'; this.dbg.lDist.textContent = '—';
    }
    if (right?.cursor) {
      this.dbg.rPos.textContent  = `${fmt(right.cursor.x)},${fmt(right.cursor.y)}`;
      this.dbg.rZone.textContent = this.activeArpIdx != null ? ARP_ZONES[this.activeArpIdx].label : '—';
      this.dbg.rDist.textContent = fmt(right.tipRatio);
    } else {
      this.dbg.rPos.textContent = '—'; this.dbg.rZone.textContent = '—'; this.dbg.rDist.textContent = '—';
    }
    if (this.dbg.chordBounds && this.chordGridEl) {
      const r = this.chordGridEl.getBoundingClientRect();
      this.dbg.chordBounds.textContent = `${r.left.toFixed(0)},${r.top.toFixed(0)}→${r.right.toFixed(0)},${r.bottom.toFixed(0)}`;
    }
    if (this.dbg.arpBounds && this.arpZonesEl) {
      const r = this.arpZonesEl.getBoundingClientRect();
      this.dbg.arpBounds.textContent = `${r.left.toFixed(0)},${r.top.toFixed(0)}→${r.right.toFixed(0)},${r.bottom.toFixed(0)}`;
    }
  }
  _renderEngineDebug() {
    if (this.dbg.ctx)    this.dbg.ctx.textContent    = (typeof Tone !== 'undefined' && Tone.context) ? Tone.context.state : '—';
    if (this.dbg.master) this.dbg.master.textContent = this.audioState.isPlaying ? 'PLAYING' : 'PAUSED';
    if (this.dbg.beat)   this.dbg.beat.textContent   = (typeof Tone !== 'undefined' && Tone.Transport.state === 'started') ? 'PLAYING' : 'PAUSED';
    if (this.dbg.harm)   this.dbg.harm.textContent   = this.audioState.isMuted ? 'MUTED' : 'PLAYING';
    if (this.dbg.bass)   this.dbg.bass.textContent   = this.audioState.bassActive ? 'ON' : 'OFF';
    if (this.dbg.chord)  this.dbg.chord.textContent  = this.audioState.currentChord || '—';
    if (this.dbg.pat)    this.dbg.pat.textContent    = this.audioState.currentPattern || '—';
    if (this.dbg.cutoff && this.padFilter) {
      try { this.dbg.cutoff.textContent = `${Math.round(this.padFilter.frequency.value)}Hz`; } catch {}
    }
    if (this.dbg.rev && this.padReverbSend) {
      try { this.dbg.rev.textContent = this.padReverbSend.gain.value.toFixed(2); } catch {}
    }
  }

  _setStatus(text) { if (this.psStatusEl) this.psStatusEl.textContent = text; }
}
