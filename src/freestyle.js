// Freestyle Mode — horizontal 4-row rhyme grid (Rhyme-Game style).
//
// Layout
//   Top    : FREESTYLE · BPM · DIFFICULTY · RHYMES (suffix)
//   Stage  : 4 horizontal rows, each row = 1 bar.
//            Each row has 4 rectangular slots; slots 1–3 are timing boxes,
//            slot 4 holds a rhyme word from the current group.
//            A glowing ball sweeps L→R across the *current* row in BPM time.
//            When the ball reaches slot 4, the word pulses; ball drops to the
//            next row at the next bar boundary. After row 4, a new rhyme
//            group is rolled.
//   Bottom : "Your Beat" player card (BPM, play/pause, bar progress) +
//            ← CREATE · DIFFICULTY · NEW WORDS · FULL TRACK toggle.
//
// Difficulty controls how many words are visible up front; the rest are "?"
// until the ball arrives at their row.

import * as Tone from 'tone';

const DWELL_MS = 700;

// Categories are pools of rhyme groups — each freestyle round picks two
// different rhyme groups (group A and group B) from the selected category and
// produces an AABB pattern: line 1 + 2 from group A, line 3 + 4 from group B.
// Slant rhymes are accepted in tougher categories (city / tech) so the pool
// is never empty.
export const WORD_LISTS = {
  'one-syllable': [
    { suffix: '-ight', words: ['light', 'night', 'bright', 'fight', 'sight', 'might'] },
    { suffix: '-ound', words: ['sound', 'ground', 'found', 'round', 'pound'] },
    { suffix: '-ow',   words: ['flow', 'glow', 'show', 'know', 'slow', 'grow'] },
    { suffix: '-eat',  words: ['beat', 'street', 'heat', 'sweet', 'feet', 'meet'] },
    { suffix: '-ay',   words: ['day', 'way', 'play', 'stay', 'say', 'gray'] },
    { suffix: '-ime',  words: ['time', 'rhyme', 'climb', 'prime', 'crime'] },
  ],
  'two-syllable': [
    { suffix: '-ower',   words: ['power', 'tower', 'shower', 'flower'] },
    { suffix: '-iver',   words: ['river', 'shiver', 'sliver', 'driver', 'quiver'] },
    { suffix: '-eather', words: ['weather', 'feather', 'leather', 'whether'] },
    { suffix: '-otion',  words: ['motion', 'ocean', 'lotion', 'devotion', 'notion'] },
    { suffix: '-ation',  words: ['nation', 'station', 'patience', 'rotation'] },
  ],
  'simple': [
    { suffix: '-at',  words: ['cat', 'bat', 'rat', 'hat', 'mat', 'flat'] },
    { suffix: '-un',  words: ['sun', 'run', 'fun', 'one', 'done', 'won'] },
    { suffix: '-ee',  words: ['tree', 'free', 'sea', 'three', 'me', 'bee'] },
    { suffix: '-ar',  words: ['star', 'far', 'car', 'jar', 'bar'] },
    { suffix: '-ain', words: ['rain', 'pain', 'brain', 'main', 'plain'] },
    { suffix: '-ock', words: ['rock', 'clock', 'lock', 'sock', 'flock'] },
  ],
  'abstract': [
    { suffix: '-ory',  words: ['memory', 'glory', 'story', 'theory'] },
    { suffix: '-eam',  words: ['dream', 'stream', 'beam', 'gleam', 'theme'] },
    { suffix: '-ight', words: ['light', 'night', 'sight', 'flight', 'insight'] },
    { suffix: '-ade',  words: ['shade', 'fade', 'shadow', 'cascade'] },
    { suffix: '-ity',  words: ['gravity', 'eternity', 'serenity', 'unity'] },
  ],
  'food': [
    { suffix: '-eese', words: ['cheese', 'freeze', 'sneeze', 'breeze'] },
    { suffix: '-itter', words: ['butter', 'batter', 'matter', 'glitter'] },
    { suffix: '-ango', words: ['mango', 'tango', 'cargo'] },
    { suffix: '-acon', words: ['bacon', 'taken', 'shaken'] },
    { suffix: '-asta', words: ['pasta', 'mocha', 'bota'] },
  ],
  'city': [
    { suffix: '-aris',  words: ['paris', 'arrows', 'narrow'] },
    { suffix: '-ondon', words: ['london', 'common', 'summon'] },
    { suffix: '-okyo',  words: ['tokyo', 'bingo', 'logo'] },
    { suffix: '-erlin', words: ['berlin', 'within', 'spinning'] },
    { suffix: '-osaka', words: ['osaka', 'lhasa', 'savanna'] },
  ],
  'emotion': [
    { suffix: '-onely', words: ['lonely', 'only', 'slowly'] },
    { suffix: '-ave',   words: ['brave', 'crave', 'wave', 'save'] },
    { suffix: '-ear',   words: ['fear', 'tear', 'near', 'clear'] },
    { suffix: '-old',   words: ['bold', 'cold', 'told', 'gold'] },
    { suffix: '-ope',   words: ['hope', 'scope', 'cope', 'slope'] },
  ],
  'tech': [
    { suffix: '-ode',    words: ['code', 'node', 'mode', 'load'] },
    { suffix: '-ata',    words: ['data', 'beta', 'theta'] },
    { suffix: '-erver',  words: ['server', 'never', 'sever', 'clever'] },
    { suffix: '-ircuit', words: ['circuit', 'forfeit', 'permit'] },
    { suffix: '-eural',  words: ['neural', 'plural', 'mural'] },
  ],
};

export const WORD_CATEGORY_LABELS = {
  'one-syllable': 'ONE SYLLABLE',
  'two-syllable': 'TWO SYLLABLE',
  'simple':       'SIMPLE',
  'abstract':     'ABSTRACT',
  'food':         'FOOD',
  'city':         'CITY',
  'emotion':      'EMOTION',
  'tech':         'TECH',
};

export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
export const DIFFICULTY_LABELS = {
  beginner:     'BEGINNER',
  intermediate: 'INTERMEDIATE',
  advanced:     'ADVANCED',
};

// 4 bars / cycle, 4 slots / bar (= 4 beats), 8 sequencer steps / bar.
const ROWS_PER_CYCLE = 4;
const SLOTS_PER_ROW = 4;

// ====================================================================
// Full Track — Tone.js generated layers on top of the user's beat.
// ====================================================================
class FullTrack {
  constructor() {
    this.enabled = false;
    // Master at 0 dB so layer-level volumes below are the actual mix.
    this.master = new Tone.Volume(0).toDestination();

    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { Q: 2, type: 'lowpass', rolloff: -24 },
      envelope: { attack: 0.005, decay: 0.22, sustain: 0.25, release: 0.4 },
      filterEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.4, baseFrequency: 80, octaves: 2.6 },
    }).connect(this.master);
    this.bass.volume.value = -4;

    this.pad = new Tone.PolySynth(Tone.AMSynth, {
      harmonicity: 2,
      oscillator: { type: 'sine' },
      modulation: { type: 'square' },
      envelope: { attack: 0.6, decay: 0.6, sustain: 0.6, release: 1.4 },
      modulationEnvelope: { attack: 0.4, decay: 0.4, sustain: 0.5, release: 0.8 },
    }).connect(this.master);
    this.pad.volume.value = -12;

    const shakerFilter = new Tone.Filter(7000, 'highpass').connect(this.master);
    this.shaker = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0 },
    }).connect(shakerFilter);
    this.shaker.volume.value = -10;

    this.sub = new Tone.MembraneSynth({
      pitchDecay: 0.08,
      octaves: 4,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.5, sustain: 0.05, release: 1.2 },
    }).connect(this.master);
    this.sub.volume.value = -2;

    this.padCycle = [
      ['C3', 'E3', 'G3'],
      ['A2', 'C3', 'E3'],
    ];
    this.padIdx = 0;
  }

  enable() { this.enabled = true; this.padIdx = 0; }
  disable() {
    this.enabled = false;
    try { this.pad.releaseAll(); } catch {}
  }

  onStep(step, time, pattern, tracks) {
    if (!this.enabled) return;
    const kickRow = tracks.indexOf('kick');
    const hasKick = kickRow >= 0 && pattern[kickRow]?.[step];

    if (hasKick) {
      this.bass.triggerAttackRelease('C2', '8n', time);
    }
    if (step === 0 || step === 4) {
      this.sub.triggerAttackRelease('C1', '4n', time);
    }
    if (step === 0) {
      const chord = this.padCycle[this.padIdx % this.padCycle.length];
      this.pad.triggerAttackRelease(chord, '2n', time);
      this.padIdx++;
    }
    if (step === 2 || step === 6) {
      this.shaker.triggerAttackRelease('32n', time);
    }
  }
}

// ====================================================================
// Freestyle UI controller.
// ====================================================================
export class Freestyle {
  constructor({ root, sequencer, getBpm, onBack, setDwellProgress, setActiveInput, ensureAudioStarted }) {
    this.root = root;
    this.sequencer = sequencer;
    this.getBpm = getBpm;
    this.onBack = onBack;
    this.setDwellProgress = setDwellProgress || (() => {});
    this.setActiveInput = setActiveInput || (() => {});
    this.ensureAudioStarted = ensureAudioStarted;

    this.difficulty = 'intermediate';
    this.category = 'simple';
    this.currentGroup = pickWordSet(this.category);
    this.displayWords = [];
    this.applyVisibility(); // sets initial displayWords
    this.currentRowIdx = 0;
    this.cycleBarCount = 0;
    this.cycleStarted = false;

    // Phase: 'setup' | 'countdown' | 'active'
    this.phase = 'setup';
    this.active = false;
    this._rafId = null;

    // Right-hand button dwell state.
    this.dwellEl = null;
    this.dwellStart = 0;
    this.frozen = null;
    this.lastHover = null;

    this.fullTrack = new FullTrack();
  }

  mount() {
    this.root.innerHTML = `
      <div class="fs-stage">
        <!-- Header chips — flex-wrap so labels never get cut off. -->
        <div class="fs-topbar">
          <div class="fs-chip">
            <span class="fs-chip-label">MODE</span>
            <span class="fs-chip-value">FREESTYLE</span>
          </div>
          <div class="fs-chip">
            <span class="fs-chip-label">BPM</span>
            <span class="fs-chip-value" id="fs-bpm">100</span>
            <span class="fs-chip-tag">SYNCED TO YOUR BEAT</span>
          </div>
          <div class="fs-chip">
            <span class="fs-chip-label">DIFFICULTY</span>
            <span class="fs-chip-value" id="fs-diff">INTERMEDIATE</span>
          </div>
          <div class="fs-chip">
            <span class="fs-chip-label">WORDS</span>
            <span class="fs-chip-value" id="fs-suffix">SIMPLE</span>
          </div>
          <div class="fs-chip" id="fs-backing-chip" data-on="false">
            <span class="fs-chip-label">BACKING</span>
            <span class="fs-chip-value" id="fs-track-state">BEAT ONLY</span>
          </div>
        </div>

        <div class="fs-stage-body">
          <div class="fs-grid" id="fs-grid">
            ${this.renderRowsHtml()}
            <div class="fs-ball" id="fs-ball" style="display:none"><span></span></div>
          </div>
          <p class="fs-caption">Follow the ball across the row. The rhyme word lands on beat 4.</p>
        </div>

        <div class="fs-footer">
          <div class="fs-beat-card">
            <div class="fs-beat-art">♫</div>
            <div class="fs-beat-meta">
              <div class="fs-beat-name">Your Beat</div>
              <div class="fs-beat-detail">
                <span id="fs-beat-bpm">100 BPM</span>
                <span class="fs-beat-divider">·</span>
                <span class="fs-beat-state" id="fs-beat-state">PAUSED</span>
              </div>
            </div>
            <button class="fs-beat-play" id="fs-beat-play" data-pinch>▶</button>
            <div class="fs-beat-progress">
              <div class="fs-beat-progress-fill" id="fs-beat-progress"></div>
            </div>
          </div>

          <div class="fs-controls">
            <button class="btn primary big fs-btn" id="fs-new" data-pinch>NEW WORDS</button>
            <button class="btn accent big fs-btn" id="fs-track" data-pinch>BACKING TRACK · OFF</button>
            <button class="btn big fs-btn" id="fs-diff-btn" data-pinch>NEXT DIFFICULTY</button>
            <button class="btn big fs-btn" id="fs-setup" data-pinch>← SETUP</button>
            <button class="btn big fs-btn" id="fs-back" data-pinch>← CREATE</button>
          </div>
          <p class="fs-controls-hint">New words drop on the beat.</p>
        </div>

        <div class="fs-feedback" id="fs-feedback"></div>

        <!-- Setup overlay — shown when entering Freestyle, before countdown. -->
        <div class="fs-setup-overlay" id="fs-setup-overlay" style="display:none">
          <div class="fs-setup-card">
            <div class="fs-setup-eyebrow">FREESTYLE</div>
            <h1 class="fs-setup-title">Set up your freestyle</h1>

            <div class="fs-setup-summary">
              <div class="fs-setup-meta">
                <span class="fs-meta-key">YOUR BEAT</span>
                <span class="fs-meta-val"><span id="fs-setup-bpm">100</span> BPM</span>
                <span class="fs-meta-detail">Freestyle will follow this BPM.</span>
              </div>
            </div>

            <div class="fs-setup-section">
              <div class="fs-setup-label">DIFFICULTY</div>
              <div class="fs-setup-options" id="fs-setup-diff">
                <button class="fs-setup-option" data-diff="beginner" data-pinch>BEGINNER</button>
                <button class="fs-setup-option active" data-diff="intermediate" data-pinch>INTERMEDIATE</button>
                <button class="fs-setup-option" data-diff="advanced" data-pinch>ADVANCED</button>
              </div>
            </div>

            <div class="fs-setup-section">
              <div class="fs-setup-label">WORD LIST</div>
              <div class="fs-setup-options grid" id="fs-setup-words">
                <button class="fs-setup-option" data-cat="one-syllable" data-pinch>ONE SYLLABLE</button>
                <button class="fs-setup-option" data-cat="two-syllable" data-pinch>TWO SYLLABLE</button>
                <button class="fs-setup-option active" data-cat="simple" data-pinch>SIMPLE</button>
                <button class="fs-setup-option" data-cat="abstract" data-pinch>ABSTRACT</button>
                <button class="fs-setup-option" data-cat="food" data-pinch>FOOD</button>
                <button class="fs-setup-option" data-cat="city" data-pinch>CITY</button>
                <button class="fs-setup-option" data-cat="emotion" data-pinch>EMOTION</button>
                <button class="fs-setup-option" data-cat="tech" data-pinch>TECH</button>
              </div>
            </div>

            <div class="fs-setup-section">
              <div class="fs-setup-label">BACKING TRACK</div>
              <button class="fs-setup-option" id="fs-setup-fulltrack" data-pinch>BACKING TRACK · OFF</button>
              <div class="fs-setup-hint fs-setup-hint-list">
                <div><strong>Off</strong> — your beat only</div>
                <div><strong>On</strong> — your beat + bass, pad, and texture</div>
              </div>
            </div>

            <div class="fs-setup-actions">
              <button id="btn-fs-setup-back"  class="btn big" data-pinch>← BACK TO CREATE</button>
              <button id="btn-fs-setup-start" class="btn primary big" data-pinch>START FREESTYLE</button>
            </div>
          </div>
        </div>

        <!-- Countdown overlay — synced to BPM, shown after Start, before active. -->
        <div class="fs-countdown-overlay" id="fs-countdown-overlay" style="display:none">
          <div class="fs-cd-num" id="fs-cd-num">3</div>
          <div class="fs-cd-label">GET READY</div>
        </div>
      </div>
    `;

    this.bpmEl       = this.root.querySelector('#fs-bpm');
    this.diffEl      = this.root.querySelector('#fs-diff');
    this.suffixEl    = this.root.querySelector('#fs-suffix');
    this.feedbackEl  = this.root.querySelector('#fs-feedback');
    this.gridEl      = this.root.querySelector('#fs-grid');
    this.ballEl      = this.root.querySelector('#fs-ball');
    this.trackBtn    = this.root.querySelector('#fs-track');
    this.trackStateEl= this.root.querySelector('#fs-track-state');
    this.beatPlayBtn = this.root.querySelector('#fs-beat-play');
    this.beatBpmEl   = this.root.querySelector('#fs-beat-bpm');
    this.beatStateEl = this.root.querySelector('#fs-beat-state');
    this.beatProgressEl = this.root.querySelector('#fs-beat-progress');

    this.root.querySelector('#fs-back').addEventListener('click', () => this.onBack());
    this.root.querySelector('#fs-diff-btn').addEventListener('click', () => this.cycleDifficulty());
    this.root.querySelector('#fs-new').addEventListener('click', () => this.newRhymeGroup());
    this.trackBtn.addEventListener('click', () => this.toggleFullTrack());
    this.beatPlayBtn.addEventListener('click', () => this.toggleTransport());

    // Setup overlay refs + listeners.
    this.setupOverlay = this.root.querySelector('#fs-setup-overlay');
    this.setupBpmEl   = this.root.querySelector('#fs-setup-bpm');
    this.setupDiffEl  = this.root.querySelector('#fs-setup-diff');
    this.setupCatsEl  = this.root.querySelector('#fs-setup-words');
    this.setupTrackBtn = this.root.querySelector('#fs-setup-fulltrack');
    this.cdOverlay    = this.root.querySelector('#fs-countdown-overlay');
    this.cdNumEl      = this.root.querySelector('#fs-cd-num');

    this.setupDiffEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-diff]');
      if (!btn) return;
      this.difficulty = btn.dataset.diff;
      this.setupDiffEl.querySelectorAll('.fs-setup-option').forEach((b) =>
        b.classList.toggle('active', b === btn));
    });
    this.setupCatsEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      this.category = btn.dataset.cat;
      this.setupCatsEl.querySelectorAll('.fs-setup-option').forEach((b) =>
        b.classList.toggle('active', b === btn));
    });
    this.setupTrackBtn?.addEventListener('click', () => {
      // Pre-toggle the backing-track preference; applied at active start.
      const next = !this._setupFullTrack;
      this._setupFullTrack = next;
      this.setupTrackBtn.textContent = next ? 'BACKING TRACK · ON' : 'BACKING TRACK · OFF';
      this.setupTrackBtn.classList.toggle('active', next);
    });
    this.root.querySelector('#btn-fs-setup-back')?.addEventListener('click', () => this.onBack());
    this.root.querySelector('#btn-fs-setup-start')?.addEventListener('click', () => this.runCountdown());

    // "← SETUP" button in active controls — return to setup screen mid-run.
    this.root.querySelector('#fs-setup')?.addEventListener('click', () => {
      this.stopAnimation();
      this.active = false;
      if (this.ballEl) this.ballEl.style.display = 'none';
      this.start();
    });

    this.updateLabels();
    this.markCurrentRow();
  }

  renderRowsHtml() {
    let html = '';
    for (let r = 0; r < ROWS_PER_CYCLE; r++) {
      let slots = '';
      for (let s = 0; s < SLOTS_PER_ROW; s++) {
        const isWord = s === SLOTS_PER_ROW - 1;
        const word = this.displayWords[r] ?? '?';
        const cls = isWord ? 'fs-slot word' : 'fs-slot';
        const content = isWord ? `<span class="fs-slot-word">${word}</span>` : '';
        slots += `<div class="${cls}" data-row="${r}" data-slot="${s}">${content}</div>`;
      }
      html += `<div class="fs-row" data-row="${r}">${slots}</div>`;
    }
    return html;
  }

  // Re-renders the rhyme word in each row's last slot. Cheap — only updates
  // text content, doesn't tear down DOM.
  refreshRowWords() {
    if (!this.gridEl) return;
    for (let r = 0; r < ROWS_PER_CYCLE; r++) {
      const wordEl = this.gridEl.querySelector(`.fs-row[data-row="${r}"] .fs-slot.word .fs-slot-word`);
      if (wordEl) wordEl.textContent = this.displayWords[r] ?? '?';
    }
  }

  markCurrentRow() {
    if (!this.gridEl) return;
    const rows = this.gridEl.querySelectorAll('.fs-row');
    rows.forEach((row, i) => row.classList.toggle('current', i === this.currentRowIdx));
  }

  // Apply the difficulty's visibility rule to displayWords from currentGroup.
  applyVisibility() {
    const d = this.difficulty;
    const g = this.currentGroup.words; // AABB: [a1, a2, b1, b2]
    if (d === 'beginner') {
      // Show all 4 words.
      this.displayWords = [...g];
    } else if (d === 'intermediate') {
      // Show pair A (rows 1+2). Hide one of pair B as '?'.
      // Picking row 4 to hide so the user gets at least one B-rhyme hint.
      this.displayWords = [g[0], g[1], g[2], '?'];
    } else {
      // Advanced: reveal words closer to when the ball arrives.
      // Show only current row's word, plus a single B-pair hint when the ball
      // is on row 1 (so the user can plan the second couplet).
      this.displayWords = g.map((w, i) => i === this.currentRowIdx ? w : '?');
    }
  }

  // For intermediate / advanced: when the ball lands on a row, reveal it.
  revealCurrentRow() {
    const i = this.currentRowIdx;
    const real = this.currentGroup.words[i];
    if (this.displayWords[i] !== real) {
      this.displayWords[i] = real;
      this.refreshRowWords();
      this.flashWordSlot(i, true);
    }
    if (this.difficulty === 'advanced') {
      // Hide everything else again.
      for (let r = 0; r < ROWS_PER_CYCLE; r++) {
        if (r !== i) this.displayWords[r] = '?';
      }
      this.refreshRowWords();
    }
  }

  newRhymeGroup() {
    this.currentGroup = pickWordSet(this.category, 4, this.currentGroup);
    this.cycleBarCount = 0;
    this.cycleStarted = false;
    this.currentRowIdx = 0;
    this.applyVisibility();
    this.refreshRowWords();
    this.markCurrentRow();
    this.updateLabels();
    this.showFeedback(`NEW WORDS · ${WORD_CATEGORY_LABELS[this.category]}`, 'good');
  }

  cycleDifficulty() {
    const i = DIFFICULTIES.indexOf(this.difficulty);
    this.difficulty = DIFFICULTIES[(i + 1) % DIFFICULTIES.length];
    this.applyVisibility();
    this.refreshRowWords();
    this.updateLabels();
    this.showFeedback(`DIFFICULTY · ${DIFFICULTY_LABELS[this.difficulty]}`);
    this.setActiveInput?.(`difficulty · ${this.difficulty}`);
  }

  toggleFullTrack() {
    const chip = this.root.querySelector('#fs-backing-chip');
    if (this.fullTrack.enabled) {
      this.fullTrack.disable();
      this.trackBtn.textContent = 'BACKING TRACK · OFF';
      this.trackBtn.classList.remove('on');
      if (this.trackStateEl) this.trackStateEl.textContent = 'BEAT ONLY';
      if (chip) chip.dataset.on = 'false';
      this.showFeedback('BACKING TRACK · OFF');
    } else {
      this.fullTrack.enable();
      this.trackBtn.textContent = 'BACKING TRACK · ON';
      this.trackBtn.classList.add('on');
      if (this.trackStateEl) this.trackStateEl.textContent = 'ON · BASS + PAD';
      if (chip) chip.dataset.on = 'true';
      this.showFeedback('BACKING TRACK · ON', 'good');
    }
  }

  toggleTransport() {
    // The sequencer owns the loop, but in Freestyle we should be able to pause/resume.
    if (Tone.Transport.state === 'started') {
      this.sequencer.stop();
      this.beatPlayBtn.textContent = '▶';
      if (this.beatStateEl) this.beatStateEl.textContent = 'PAUSED';
    } else {
      this.sequencer.ensurePlaying();
      this.beatPlayBtn.textContent = '❚❚';
      if (this.beatStateEl) this.beatStateEl.textContent = 'PLAYING';
    }
  }

  // Entry point — shows the setup screen first.
  async start() {
    this.phase = 'setup';
    this.active = false;
    document.body.classList.remove('mode-freestyle', 'mode-freestyle-countdown');
    document.body.classList.add('mode-freestyle-setup');
    if (this.setupOverlay) this.setupOverlay.style.display = 'flex';
    if (this.cdOverlay) this.cdOverlay.style.display = 'none';
    if (this.setupBpmEl) this.setupBpmEl.textContent = String(this.getBpm());
    if (this.ballEl) this.ballEl.style.display = 'none';
    // Reflect any prior selections in the option pills.
    this.syncSetupSelections();
  }

  syncSetupSelections() {
    if (this.setupDiffEl) {
      this.setupDiffEl.querySelectorAll('.fs-setup-option').forEach((b) =>
        b.classList.toggle('active', b.dataset.diff === this.difficulty));
    }
    if (this.setupCatsEl) {
      this.setupCatsEl.querySelectorAll('.fs-setup-option').forEach((b) =>
        b.classList.toggle('active', b.dataset.cat === this.category));
    }
    if (this.setupTrackBtn) {
      const on = !!this._setupFullTrack;
      this.setupTrackBtn.textContent = on ? 'BACKING TRACK · ON' : 'BACKING TRACK · OFF';
      this.setupTrackBtn.classList.toggle('active', on);
    }
  }

  // BPM-synced countdown: 3, 2, 1, FREESTYLE — each beat one number.
  // Beat audibly starts on FREESTYLE so the user can hear the downbeat clearly.
  async runCountdown() {
    if (this.ensureAudioStarted) await this.ensureAudioStarted();
    if (this.setupOverlay) this.setupOverlay.style.display = 'none';
    if (this.cdOverlay) this.cdOverlay.style.display = 'flex';
    document.body.classList.remove('mode-freestyle-setup', 'mode-freestyle');
    document.body.classList.add('mode-freestyle-countdown');
    this.phase = 'countdown';

    // Apply the chosen backing-track state from setup.
    const backingChip = this.root.querySelector('#fs-backing-chip');
    if (this._setupFullTrack && !this.fullTrack.enabled) {
      this.fullTrack.enable();
      if (this.trackBtn) {
        this.trackBtn.textContent = 'BACKING TRACK · ON';
        this.trackBtn.classList.add('on');
      }
      if (this.trackStateEl) this.trackStateEl.textContent = 'ON · BASS + PAD';
      if (backingChip) backingChip.dataset.on = 'true';
    } else if (!this._setupFullTrack && this.fullTrack.enabled) {
      this.fullTrack.disable();
      if (this.trackBtn) {
        this.trackBtn.textContent = 'BACKING TRACK · OFF';
        this.trackBtn.classList.remove('on');
      }
      if (this.trackStateEl) this.trackStateEl.textContent = 'BEAT ONLY';
      if (backingChip) backingChip.dataset.on = 'false';
    }

    // Pick a fresh word set for the chosen category and apply visibility.
    this.currentGroup = pickWordSet(this.category);
    this.applyVisibility();
    this.refreshRowWords();
    this.updateLabels();

    const bpm = this.getBpm();
    const beatMs = 60000 / bpm;
    const labels = ['3', '2', '1', 'FREESTYLE'];
    for (let i = 0; i < labels.length; i++) {
      if (this.phase !== 'countdown') return; // bailed (e.g. user went back)
      this.cdNumEl.textContent = labels[i];
      this.cdNumEl.classList.remove('flash');
      void this.cdNumEl.offsetWidth;
      this.cdNumEl.classList.add('flash');
      await new Promise((r) => setTimeout(r, beatMs));
    }
    if (this.phase !== 'countdown') return;
    this.runActive();
  }

  // Actual freestyle stage starts here — beat begins playing on this transition.
  async runActive() {
    if (this.cdOverlay) this.cdOverlay.style.display = 'none';
    document.body.classList.remove('mode-freestyle-setup', 'mode-freestyle-countdown');
    document.body.classList.add('mode-freestyle');
    this.phase = 'active';

    this.active = true;
    this.cycleBarCount = 0;
    this.cycleStarted = false;
    this.currentRowIdx = 0;
    this.sequencer.ensurePlaying();
    this.applyVisibility();
    this.refreshRowWords();
    this.markCurrentRow();
    this.updateLabels();
    this.startAnimation();
    if (this.beatPlayBtn) this.beatPlayBtn.textContent = '❚❚';
    if (this.beatStateEl) this.beatStateEl.textContent = 'PLAYING';
    if (this.ballEl) this.ballEl.style.display = 'block';
  }

  stop() {
    this.active = false;
    this.phase = 'setup';
    this.stopAnimation();
    if (this.ballEl) this.ballEl.style.display = 'none';
    if (this.setupOverlay) this.setupOverlay.style.display = 'none';
    if (this.cdOverlay) this.cdOverlay.style.display = 'none';
    document.body.classList.remove('mode-freestyle', 'mode-freestyle-setup', 'mode-freestyle-countdown');
    // Don't stop the sequencer — Create Mode may pick it up.
  }

  startAnimation() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    const tick = () => {
      if (!this.active) return;
      this.updateBall();
      this.updateBeatProgress();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }
  stopAnimation() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  // Ball position — bounces ABOVE the current row's top line, like the
  // Rhyme-Game reference. One arc per beat (4 arcs per bar). At each beat the
  // ball briefly touches the row line; between beats it arcs upward.
  updateBall() {
    if (!this.ballEl || !this.gridEl) return;
    const rowEl = this.gridEl.querySelector(`.fs-row[data-row="${this.currentRowIdx}"]`);
    if (!rowEl) return;
    const gridBox = this.gridEl.getBoundingClientRect();
    const rowBox  = rowEl.getBoundingClientRect();
    // Anchor the ball to the row's top edge.
    const rowTopPx = rowBox.top - gridBox.top;
    const ARC_HEIGHT = 38; // peak px above the row
    const MIN_GAP = 10;    // ball never gets closer than this to the row top

    if (Tone.Transport.state !== 'started') {
      this.ballEl.style.top = `${rowTopPx - ARC_HEIGHT}px`;
      this.ballEl.style.left = `0px`;
      return;
    }

    const ppq = Tone.Transport.PPQ || 192;
    const ticks = Tone.Transport.ticks;
    const ticksPerBar = ppq * 4;
    const positionInBar = (ticks % ticksPerBar) / ticksPerBar; // 0..1
    const leftPx = positionInBar * rowBox.width;

    // 4 arcs per bar (one per beat). sin = 0 at beat boundaries → ball dips
    // toward the block; sin = 1 mid-beat → ball rises. MIN_GAP keeps the ball
    // visibly ABOVE the block at all times — it never touches.
    const wave = Math.abs(Math.sin(positionInBar * Math.PI * 4));
    const arc = MIN_GAP + wave * (ARC_HEIGHT - MIN_GAP);
    const topPx = rowTopPx - arc;

    this.ballEl.style.top = `${topPx}px`;
    this.ballEl.style.left = `${leftPx}px`;

    const slot = Math.min(SLOTS_PER_ROW - 1, Math.floor(positionInBar * SLOTS_PER_ROW));
    this.lightSlot(this.currentRowIdx, slot);
  }

  updateBeatProgress() {
    if (!this.beatProgressEl) return;
    if (Tone.Transport.state !== 'started') {
      this.beatProgressEl.style.width = '0%';
      return;
    }
    const ppq = Tone.Transport.PPQ || 192;
    const ticks = Tone.Transport.ticks;
    const ticksPerBar = ppq * 4;
    const positionInBar = (ticks % ticksPerBar) / ticksPerBar;
    this.beatProgressEl.style.width = `${positionInBar * 100}%`;
  }

  // Light up only one slot in one row.
  lightSlot(rowIdx, slotIdx) {
    if (!this.gridEl) return;
    const slots = this.gridEl.querySelectorAll('.fs-slot');
    slots.forEach((el) => {
      const r = +el.dataset.row;
      const s = +el.dataset.slot;
      el.classList.toggle('active', r === rowIdx && s === slotIdx);
    });
  }

  flashWordSlot(rowIdx, isReveal = false) {
    if (!this.gridEl) return;
    const wordEl = this.gridEl.querySelector(`.fs-row[data-row="${rowIdx}"] .fs-slot.word`);
    if (!wordEl) return;
    const cls = isReveal ? 'reveal' : 'pulse';
    wordEl.classList.remove(cls);
    void wordEl.offsetWidth;
    wordEl.classList.add(cls);
    setTimeout(() => wordEl.classList.remove(cls), 700);
  }

  // Driven by sequencer.onStep when this mode is active.
  onStep(s, time) {
    if (!this.active) return;

    this.fullTrack.onStep(s, time, this.sequencer.pattern, this.sequencer.tracks);

    if (s === 0) {
      if (this.cycleStarted) this.advanceBar();
      else this.cycleStarted = true;
    }
  }

  advanceBar() {
    // Pulse the just-completed row's word slot — that's the "drop on beat 4" cue.
    this.flashWordSlot(this.cycleBarCount, false);

    this.cycleBarCount += 1;
    if (this.cycleBarCount >= ROWS_PER_CYCLE) {
      // Cycle finished — pick a new rhyme group and reset.
      this.cycleBarCount = 0;
      this.currentRowIdx = 0;
      this.currentGroup = pickWordSet(this.category, 4, this.currentGroup);
      this.applyVisibility();
      this.refreshRowWords();
      this.updateLabels();
    } else {
      this.currentRowIdx = this.cycleBarCount;
      this.revealCurrentRow();
    }
    this.markCurrentRow();
  }

  updateLabels() {
    if (this.bpmEl) this.bpmEl.textContent = `${this.getBpm()}`;
    if (this.diffEl) this.diffEl.textContent = DIFFICULTY_LABELS[this.difficulty];
    if (this.suffixEl) {
      const a = this.currentGroup?.groupA?.suffix;
      const b = this.currentGroup?.groupB?.suffix;
      const cat = WORD_CATEGORY_LABELS[this.category];
      this.suffixEl.textContent = (a && b)
        ? `${cat} · ${a} / ${b}`
        : cat;
    }
    if (this.beatBpmEl) this.beatBpmEl.textContent = `${this.getBpm()} BPM`;
  }

  showFeedback(text, kind = 'info') {
    if (!this.feedbackEl) return;
    this.feedbackEl.textContent = text;
    this.feedbackEl.className = `fs-feedback show ${kind}`;
    clearTimeout(this._fadeTimer);
    this._fadeTimer = setTimeout(() => {
      this.feedbackEl.classList.remove('show');
    }, 1200);
  }

  // Same hover-or-pinch dwell button model as Create Mode.
  handFrame(data) {
    if (!data) return;
    const hand = data.hand ?? data.right ?? data.left;
    if (!hand?.cursor) {
      if (this.dwellEl) this.dwellEl.style.setProperty('--dwell-fill', '0%');
      this.dwellEl = null;
      this.frozen = null;
      this.setDwellProgress(0);
      return;
    }

    const x = hand.cursor.x * window.innerWidth;
    const y = hand.cursor.y * window.innerHeight;
    const el = document.elementFromPoint(x, y);
    const btn = el?.closest('.fs-btn, .btn-mini, .fs-beat-play, .fs-setup-option, #btn-fs-setup-back, #btn-fs-setup-start');

    if (btn !== this.lastHover) {
      this.lastHover?.classList.remove('hand-hover');
      btn?.classList.add('hand-hover');
      this.lastHover = btn;
    }

    if (hand.pinchTriggered && btn) {
      btn.click();
      btn.classList.add('pinch-flash');
      setTimeout(() => btn.classList.remove('pinch-flash'), 250);
      this.frozen = btn;
      this.dwellEl = null;
      this.setDwellProgress(0);
      return;
    }

    const now = performance.now();
    if (btn !== this.frozen) this.frozen = null;

    if (btn && !this.frozen) {
      if (this.dwellEl !== btn) {
        this.dwellEl = btn;
        this.dwellStart = now;
      }
      const elapsed = now - this.dwellStart;
      const pct = Math.min(100, (elapsed / DWELL_MS) * 100);
      this.setDwellProgress(pct);
      btn.style.setProperty('--dwell-fill', `${pct}%`);
      if (elapsed >= DWELL_MS) {
        btn.click();
        btn.classList.add('pinch-flash');
        setTimeout(() => btn.classList.remove('pinch-flash'), 250);
        this.frozen = btn;
        this.dwellEl = null;
        this.setDwellProgress(0);
        btn.style.setProperty('--dwell-fill', '0%');
      }
    } else {
      if (this.dwellEl) this.dwellEl.style.setProperty('--dwell-fill', '0%');
      this.dwellEl = null;
      this.setDwellProgress(0);
    }
  }
}

// AABB rhyme picker — pick two different rhyme groups from the category and
// take 2 words from each so lines 1+2 rhyme and lines 3+4 rhyme.
//
// Returns { category, groupA, groupB, words: [a1, a2, b1, b2] }.
function pickWordSet(category, _unused, avoid) {
  const groups = WORD_LISTS[category] || WORD_LISTS['simple'];
  if (!groups.length) {
    return { category, groupA: null, groupB: null, words: ['?', '?', '?', '?'] };
  }
  const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

  // Pick groupA, avoiding the previous round's groupA when possible.
  const avoidA = avoid?.groupA?.suffix;
  let groupAPool = groups;
  if (avoidA && groups.length > 1) {
    groupAPool = groups.filter((g) => g.suffix !== avoidA);
  }
  const groupA = groupAPool[Math.floor(Math.random() * groupAPool.length)];

  // Pick groupB ≠ groupA. If category has only one group, reuse it (degenerate).
  let groupB = groupA;
  if (groups.length > 1) {
    const others = groups.filter((g) => g.suffix !== groupA.suffix);
    groupB = others[Math.floor(Math.random() * others.length)];
  }

  const aWords = shuffle(groupA.words).slice(0, 2);
  const bWords = shuffle(groupB.words).slice(0, 2);
  // Pad with '?' if a group somehow has < 2 words.
  while (aWords.length < 2) aWords.push('?');
  while (bWords.length < 2) bWords.push('?');

  return {
    category,
    groupA,
    groupB,
    words: [aWords[0], aWords[1], bWords[0], bWords[1]],
  };
}
