import './styles.css';
import * as Tone from 'tone';
import { AudioEngine } from './audioEngine.js';
import { HandTracker, Calibration } from './handTracking.js';
import { Sequencer } from './sequencer.js';
import { Freestyle } from './freestyle.js';
import { PerformanceMode } from './performanceMode.js';

const TRACKS = ['hihat', 'clap', 'snare', 'kick'];
const STEPS = 8;

const state = {
  mode: 'create',          // 'create' | 'freestyle'
  pattern: TRACKS.map(() => Array(STEPS).fill(false)),
  bpm: 100,
  audioStarted: false,
};

const app = document.getElementById('app');
app.innerHTML = `
  <header class="topbar">
    <div class="brand">◆ BEATBOX ARCADE</div>
    <div class="tagline">create · freestyle · perform · right hand pinches and dwells</div>
    <div class="topbar-actions">
      <button id="btn-help" class="btn-mini" type="button" title="Show tutorial">? HOW TO USE</button>
    </div>
  </header>

  <div class="app-shell">
    <aside class="webcam-host">
      <div class="webcam-label">
        <span>cv · webcam</span>
        <span id="cal-state" class="cal-state">DEFAULT</span>
      </div>
      <div id="hand-status" class="hand-status">ALLOW CAMERA ACCESS</div>
      <div id="webcam-slot" class="webcam-slot">
        <div id="calibrate-overlay" class="calibrate-overlay" style="display:none">
          <div class="cal-msg" id="cal-msg">HOLD OPEN HAND</div>
          <div class="cal-bar"><div id="cal-fill" class="cal-fill"></div></div>
        </div>
      </div>
      <div class="webcam-actions">
        <button id="btn-calibrate" class="btn-mini" data-pinch>CALIBRATE</button>
      </div>
      <!-- Persistent role labels — right hand is enough for everything in
           Create Mode. Left hand is supplemental (alt placement, tempo). -->
      <div class="role-labels">
        <div class="role-label right"><span class="role-key">RIGHT HAND</span><span class="role-action">= AIM + PINCH</span></div>
        <div class="role-label left"><span class="role-key">LEFT HAND</span><span class="role-action">= OPTIONAL</span></div>
      </div>
      <ol class="how-to-card">
        <li><span class="ht-num">1</span><span class="ht-text"><strong>Hover</strong> a square with your right hand.</span></li>
        <li><span class="ht-num">2</span><span class="ht-text"><strong>Pinch</strong> thumb + index to place a sound.</span></li>
        <li><span class="ht-num">3</span><span class="ht-text"><strong>Hover</strong> any button until the ring fills to select.</span></li>
      </ol>
      <div class="debug-panel" id="debug-panel">
        <div class="debug-row"><span>left</span><span id="dbg-left">—</span></div>
        <div class="debug-row"><span>right</span><span id="dbg-right">—</span></div>
        <div class="debug-row"><span>input</span><span id="dbg-input">—</span></div>
      </div>
    </aside>

    <main id="screen-create" class="screen active"></main>
    <main id="screen-freestyle" class="screen"></main>
    <main id="screen-performance" class="screen"></main>
  </div>

  <div id="hand-cursor-right" class="hand-cursor hand-right" style="display:none">
    <div class="dwell-progress"></div>
  </div>
  <div id="hand-cursor-left" class="hand-cursor hand-left" style="display:none">
    <div class="dwell-progress"></div>
  </div>

  <!-- Welcome modal — first thing the user sees on load. Three numbered
       steps explain the flow before any mini-tutorial fires. Both
       buttons are dwell-activatable; the modal does NOT auto-advance,
       the user must explicitly choose Start or Skip. The "? HOW TO USE"
       button in the topbar restarts the flow at any time. -->
  <div id="intro-overlay" class="intro-overlay" style="display:none">
    <div class="intro-card welcome-card welcome-card-v2">
      <div class="intro-eyebrow">WELCOME</div>
      <h1 class="intro-title">Beatbox Arcade</h1>
      <p class="intro-subtitle">Make a beat with your hand, then perform it like a song.</p>
      <ol class="welcome-steps">
        <li>
          <span class="ws-num">1</span>
          <div class="ws-text">
            <div class="ws-title">Build a beat</div>
            <div class="ws-body">Hover over the grid and pinch to place sounds.</div>
          </div>
        </li>
        <li>
          <span class="ws-num">2</span>
          <div class="ws-text">
            <div class="ws-title">Play your beat</div>
            <div class="ws-body">Hover over Play and hold until the ring fills.</div>
          </div>
        </li>
        <li>
          <span class="ws-num">3</span>
          <div class="ws-text">
            <div class="ws-title">Perform it</div>
            <div class="ws-body">Use Performance Mode to add chords and arpeggios with both hands.</div>
          </div>
        </li>
      </ol>
      <div class="welcome-actions">
        <button id="btn-intro-skip" class="btn big" type="button" data-hand-dwell data-tutorial-dismiss data-dwell-ms="1800">SKIP TUTORIAL</button>
        <button id="btn-intro-start" class="btn primary big" type="button" data-hand-dwell data-tutorial-dismiss data-dwell-ms="1500">START GUIDED TUTORIAL</button>
      </div>
    </div>
  </div>

  <!-- Step popover — positioned at runtime next to its anchor. Inner
       HTML is rebuilt by the OnboardingController each step. -->
  <div id="onboard-step" class="onboard-step" style="display:none"></div>

  <div id="status-bar" class="status-bar">Loading…</div>
  <div class="kbd-fallback-note">fallback · SPACE plays/stops</div>
`;

document.body.classList.add('mode-create');

// Tutorials show every page load for demo/testing — clear any persisted
// "seen" flags up front so refresh always retriggers the Create-Mode intro
// and the Performance-Mode intro. HELP / HOW TO PLAY buttons always reopen.
try {
  localStorage.removeItem('beatbox.introSeen.v1');
  localStorage.removeItem('beatbox.tempoTutorialSeen.v1');
  ['intro', 'slider', 'chord', 'swell', 'arp', 'arpSpeed', 'transport'].forEach((k) => {
    localStorage.removeItem(`perfMode.tut.${k}.v1`);
  });
} catch {}

const introOverlay = document.getElementById('intro-overlay');
const introStartBtn = document.getElementById('btn-intro-start');
const introSkipBtn  = document.getElementById('btn-intro-skip');
const helpBtn = document.getElementById('btn-help');
const onboardEl = document.getElementById('onboard-step');

// Step-by-step onboarding controller. Each step is a small popover
// anchored to the UI it teaches; both Skip and Got It are dwell-clickable
// and tagged data-tutorial-dismiss so the existing tutorialDwellTick
// in main.js can fire them. Auto-advances when the targeted action
// happens (placing a beat, hitting Play, etc.) so the user only sees
// each hint while it's relevant.
// Tiny per-step gesture demos — pure-CSS animated emoji hands so the
// user sees the physical motion before they try it. All demos are
// pointer-events: none and live inside the card; the real hand cursor
// (z-index 99999) draws over them.
const GESTURE_DEMOS = {
  pinch: `
    <div class="gesture-demo pinch-demo" aria-hidden="true">
      <span class="gd-hand gd-hand-open">✋</span>
      <span class="gd-hand gd-hand-pinch">🤏</span>
      <div class="gd-row">
        <span class="gd-cell"></span>
        <span class="gd-cell gd-cell-target"></span>
        <span class="gd-cell"></span>
        <span class="gd-cell"></span>
      </div>
    </div>`,
  hoverDwell: (label = 'PLAY') => `
    <div class="gesture-demo hover-dwell-demo" aria-hidden="true">
      <span class="gd-button">${label}</span>
      <span class="gd-ring"></span>
      <span class="gd-hand">👉</span>
    </div>`,
  slider: `
    <div class="gesture-demo slider-demo" aria-hidden="true">
      <div class="gd-track"><span class="gd-knob"></span></div>
      <span class="gd-hand">🖐️</span>
      <div class="gd-bpm">
        <div class="gd-bpm-num">
          <span>95</span><span>120</span><span>145</span>
        </div>
        <div class="gd-bpm-label">BPM</div>
      </div>
    </div>`,
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
};

const CREATE_STEPS = [
  {
    key: 'grid',
    anchor: '#beat-grid',
    placement: 'right',
    title: 'Pinch to place a beat',
    body: 'Move your hand over a square, then <strong>pinch</strong> your thumb and index finger.',
    demo: GESTURE_DEMOS.pinch,
  },
  {
    key: 'play',
    anchor: '#btn-play',
    placement: 'top',
    title: 'Hover Play to start',
    body: 'Hold your right hand over <strong>PLAY</strong> until the ring fills.',
    demo: GESTURE_DEMOS.hoverDwell('PLAY'),
  },
  {
    key: 'tempo',
    anchor: '#tempo-panel',
    placement: 'left',
    title: 'Move to change tempo',
    body: 'Hover the tempo control, then move your hand <strong>up or down</strong> to change the speed.',
    demo: GESTURE_DEMOS.slider,
  },
  {
    key: 'performance',
    anchor: '#btn-performance',
    placement: 'top',
    title: 'Open Performance Mode',
    body: 'Hover <strong>PERFORMANCE MODE</strong> to turn your beat into a full song.',
    demo: GESTURE_DEMOS.hoverDwell('PERF'),
  },
];

const onboarding = {
  active: false,    // true between Start Tutorial and Skip
  stepIdx: -1,      // -1 == no step shown
  beatPlaced: false,
  played: false,
  tempoChanged: false,
};

function showIntro() {
  if (!introOverlay) return;
  introOverlay.classList.remove('out');
  introOverlay.style.display = 'flex';
}
function hideIntro() {
  if (!introOverlay) return;
  introOverlay.classList.add('out');
  setTimeout(() => {
    introOverlay.style.display = 'none';
    introOverlay.classList.remove('out');
  }, 220);
}

function positionStep(anchorEl, placement) {
  if (!anchorEl || !onboardEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const card = onboardEl.firstElementChild;
  if (!card) return;
  const cardRect = card.getBoundingClientRect();
  const margin = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x, y, p = placement;
  if (p === 'right') {
    x = rect.right + margin;
    y = rect.top + rect.height / 2 - cardRect.height / 2;
    if (x + cardRect.width > vw - 8) { x = rect.left - cardRect.width - margin; p = 'left'; }
  } else if (p === 'left') {
    x = rect.left - cardRect.width - margin;
    y = rect.top + rect.height / 2 - cardRect.height / 2;
    if (x < 8) { x = rect.right + margin; p = 'right'; }
  } else if (p === 'top') {
    x = rect.left + rect.width / 2 - cardRect.width / 2;
    y = rect.top - cardRect.height - margin;
    if (y < 8) { y = rect.bottom + margin; p = 'bottom'; }
  } else { // bottom
    x = rect.left + rect.width / 2 - cardRect.width / 2;
    y = rect.bottom + margin;
    if (y + cardRect.height > vh - 8) { y = rect.top - cardRect.height - margin; p = 'top'; }
  }
  x = Math.max(8, Math.min(x, vw - cardRect.width - 8));
  y = Math.max(8, Math.min(y, vh - cardRect.height - 8));
  onboardEl.style.left = `${x}px`;
  onboardEl.style.top  = `${y}px`;
  onboardEl.dataset.placement = p;
}

function renderStep(idx) {
  if (!onboardEl) return;
  const step = CREATE_STEPS[idx];
  if (!step) return;
  onboardEl.innerHTML = `
    <div class="onboard-card" data-step="${step.key}">
      ${step.demo || ''}
      <div class="onboard-eyebrow">STEP ${idx + 1} OF ${CREATE_STEPS.length}</div>
      <div class="onboard-title">${step.title}</div>
      <div class="onboard-body">${step.body}</div>
      <div class="try-it-now"><span class="tin-pulse"></span>Try it now — the tutorial stays open</div>
      <div class="onboard-actions">
        <button class="btn" type="button" data-hand-dwell data-tutorial-dismiss data-onboard-action="skip" data-dwell-ms="1800">SKIP TUTORIAL</button>
        <button class="btn primary" type="button" data-hand-dwell data-tutorial-dismiss data-onboard-action="next" data-dwell-ms="1500">GOT IT</button>
      </div>
    </div>
  `;
  onboardEl.style.display = 'block';
  // Position after the next paint so we can measure the card.
  requestAnimationFrame(() => {
    const anchor = document.querySelector(step.anchor);
    positionStep(anchor, step.placement);
  });
  onboardEl.querySelector('[data-onboard-action="skip"]')
    ?.addEventListener('click', () => onboardingSkip());
  onboardEl.querySelector('[data-onboard-action="next"]')
    ?.addEventListener('click', () => onboardingAdvance());
}

function hideStep() {
  if (!onboardEl) return;
  onboardEl.style.display = 'none';
  onboardEl.innerHTML = '';
}

function startOnboarding() {
  onboarding.active = true;
  onboarding.stepIdx = 0;
  renderStep(0);
}
function onboardingAdvance() {
  if (!onboarding.active) return;
  onboarding.stepIdx += 1;
  if (onboarding.stepIdx >= CREATE_STEPS.length) {
    onboardingFinish();
    return;
  }
  renderStep(onboarding.stepIdx);
}
function onboardingSkip() {
  onboarding.active = false;
  onboarding.stepIdx = -1;
  hideStep();
}
function onboardingFinish() {
  onboarding.active = false;
  onboarding.stepIdx = -1;
  hideStep();
}

// Anyone (sequencer, mode switch) can fire one of these when the user
// performs the action a step is teaching; if that step is currently
// shown, advance — *with* a cooldown so the auto-advance can't
// rubber-band into a dwell on the next step's GOT IT button.
function onboardingNotify(action) {
  if (!onboarding.active) return;
  const cur = CREATE_STEPS[onboarding.stepIdx];
  if (!cur) return;
  const map = {
    placed:    'grid',
    played:    'play',
    tempoSet:  'tempo',
    performance: 'performance',
  };
  if (map[action] === cur.key) {
    startTutCooldown();
    onboardingAdvance();
  }
}

if (introOverlay) showIntro();
introStartBtn?.addEventListener('click', () => { hideIntro(); startOnboarding(); });
introSkipBtn?.addEventListener('click',  () => { hideIntro(); onboardingSkip(); });
// "? HOW TO USE" replays the flow from the welcome modal.
helpBtn?.addEventListener('click', () => {
  onboardingSkip();
  showIntro();
});
window.addEventListener('resize', () => {
  if (!onboarding.active || onboarding.stepIdx < 0) return;
  const step = CREATE_STEPS[onboarding.stepIdx];
  positionStep(document.querySelector(step.anchor), step.placement);
});

const audio = new AudioEngine();
const calibration = new Calibration();

const dbg = {
  left: document.getElementById('dbg-left'),
  right: document.getElementById('dbg-right'),
  input: document.getElementById('dbg-input'),
};

// Pretty label for the left-hand pinch state (for the debug panel).
function leftPinchLabel(state) {
  switch (state) {
    case 'preview':   return 'preview';
    case 'ready':     return 'ready';
    case 'triggered': return 'CONFIRMED';
    case 'held':      return 'held';
    case 'cooldown':  return 'cooldown';
    default:          return '—';
  }
}
const calStateEl = document.getElementById('cal-state');
const calOverlay = document.getElementById('calibrate-overlay');
const calMsg = document.getElementById('cal-msg');
const calFill = document.getElementById('cal-fill');
const btnCalibrate = document.getElementById('btn-calibrate');
const cursorRightEl = document.getElementById('hand-cursor-right');
const cursorLeftEl = document.getElementById('hand-cursor-left');

function setActiveInput(label) {
  if (dbg.input) dbg.input.textContent = label;
}

const handStatusEl = document.getElementById('hand-status');
function setHandStatus(text, tone = '') {
  if (!handStatusEl) return;
  handStatusEl.textContent = text;
  handStatusEl.className = `hand-status${tone ? ' ' + tone : ''}`;
}

// Drive the dwell ring on whichever cursor is currently dwelling.
function setDwellProgress(pct, side = 'right') {
  const el = side === 'left' ? cursorLeftEl : cursorRightEl;
  if (!el) return;
  const clamped = Math.max(0, Math.min(100, pct));
  el.style.setProperty('--dwell', String(clamped));
  el.classList.toggle('dwelling', clamped > 0 && clamped < 100);
}

function setBpm(bpm) {
  state.bpm = Math.max(70, Math.min(150, Math.round(bpm)));
  Tone.Transport.bpm.value = state.bpm;
  sequencer?.updateTempo?.(state.bpm);
  freestyle?.updateLabels?.();
}

function getBpm() { return state.bpm; }

function updateCalState() {
  if (!calStateEl) return;
  if (calibration.calibrating) {
    calStateEl.textContent = 'CALIBRATING';
    calStateEl.className = 'cal-state calibrating';
  } else if (calibration.calibrated) {
    calStateEl.textContent = `CAL ${calibration.openSpread.toFixed(2)}`;
    calStateEl.className = 'cal-state calibrated';
  } else {
    calStateEl.textContent = 'DEFAULT';
    calStateEl.className = 'cal-state';
  }
  if (btnCalibrate) {
    btnCalibrate.textContent = calibration.calibrated ? 'RECALIBRATE' : 'CALIBRATE';
  }
}
updateCalState();

calibration.on((evt) => {
  if (evt.kind === 'started') {
    calOverlay.style.display = 'flex';
    calMsg.textContent = 'HOLD OPEN HAND';
    calFill.style.width = '0%';
  } else if (evt.kind === 'progress') {
    calFill.style.width = `${(evt.progress * 100).toFixed(0)}%`;
  } else if (evt.kind === 'done') {
    calMsg.textContent = `CALIBRATED · ${evt.openSpread.toFixed(2)}`;
    calFill.style.width = '100%';
    setTimeout(() => { calOverlay.style.display = 'none'; }, 700);
    setActiveInput('calibration ok');
  } else if (evt.kind === 'failed') {
    calMsg.textContent = 'TRY AGAIN — SHOW OPEN HAND';
    setTimeout(() => { calOverlay.style.display = 'none'; }, 1100);
  } else if (evt.kind === 'cancelled') {
    calOverlay.style.display = 'none';
  }
  updateCalState();
});

btnCalibrate.addEventListener('click', () => {
  if (calibration.calibrating) calibration.cancel();
  else calibration.begin();
});

const sequencer = new Sequencer({
  root: document.getElementById('screen-create'),
  tracks: TRACKS,
  steps: STEPS,
  pattern: state.pattern,
  audio,
  getBpm,
  setBpm,
  setDwellProgress: (pct) => setDwellProgress(pct, 'right'),
  // Tempo mini popup intentionally not wired — only the main Create
  // and Performance Mode tutorials should appear.
  onCellToggle: (row, col, source = 'mouse') => {
    state.pattern[row][col] = !state.pattern[row][col];
    sequencer.render();
    setActiveInput(`${source} · ${TRACKS[row]}·${col + 1}`);
    if (!onboarding.beatPlaced) {
      onboarding.beatPlaced = true;
      onboardingNotify('placed');
    }
  },
  onPlay: async () => {
    await ensureAudioStarted();
    sequencer.play();
    sequencer.showFeedback('PLAYING', 'good');
    setActiveInput('play');
    if (!onboarding.played) {
      onboarding.played = true;
      onboardingNotify('played');
    }
  },
  onStop: () => {
    sequencer.stop();
    sequencer.showFeedback('STOPPED');
    setActiveInput('stop');
  },
  onClear: () => {
    for (let r = 0; r < TRACKS.length; r++)
      for (let c = 0; c < STEPS; c++) state.pattern[r][c] = false;
    sequencer.render();
    sequencer.showFeedback('CLEARED');
    setActiveInput('clear');
  },
  onGoToFreestyle: async () => {
    await ensureAudioStarted();
    sequencer.showFeedback('ENTERING FREESTYLE', 'accent');
    setTimeout(() => switchMode('freestyle'), 200);
    setActiveInput('→ freestyle');
  },
  onGoToPerformance: async () => {
    await ensureAudioStarted();
    sequencer.showFeedback('ENTERING PERFORMANCE (EXPERIMENTAL)', 'accent');
    setTimeout(() => switchMode('performance'), 200);
    setActiveInput('→ performance');
    onboardingNotify('performance');
  },
  onEnterTempoMode: () => {
    // Fires when the user hovers ADJUST TEMPO. We treat reaching the
    // tempo panel as "saw the tempo step" — set fires on actual change.
    if (!onboarding.tempoChanged) onboardingNotify('tempoSet');
  },
  // Step tick — main routes to whichever mode is active.
  onStep: (s, time) => {
    if (state.mode === 'freestyle') freestyle.onStep(s, time);
    else if (state.mode === 'performance') perfMode.onStep(s, time);
  },
});

const freestyle = new Freestyle({
  root: document.getElementById('screen-freestyle'),
  sequencer,
  getBpm,
  ensureAudioStarted,
  setDwellProgress: (pct) => setDwellProgress(pct, 'right'),
  setActiveInput,
  onBack: () => {
    freestyle.stop();
    switchMode('create');
    setActiveInput('← create');
  },
});

// Performance Mode (Experimental) — kept in its own file for easy removal.
// Variable name is `perfMode` (not `performance`) to avoid shadowing the
// global `performance` API (e.g. `performance.now()`).
const perfMode = new PerformanceMode({
  root: document.getElementById('screen-performance'),
  getBpm,
  sequencer,
  ensureAudioStarted,
  setActiveInput,
  // Either hand can dwell over transport buttons in Performance Mode;
  // this drives the cursor ring on whichever side is dwelling.
  setDwellProgress,
  onBack: () => {
    perfMode.stop();
    switchMode('create');
    setActiveInput('← create');
  },
});

sequencer.mount();
freestyle.mount();
perfMode.mount();
sequencer.updateTempo(state.bpm);

const statusBar = document.getElementById('status-bar');
function setStatus(msg) { statusBar.textContent = msg; }

// Mode-agnostic tutorial dwell-press. While any tutorial modal is open,
// a hand cursor inside the GOT IT / START BUILDING button bounds fills a
// progress ring and clicks after the button's dwell duration — so the
// user can close every tutorial without keyboard or mouse. Pinch-trigger
// inside the button bounds also fires immediately, but is gated by the
// same cooldown so it can't chain-skip back-to-back steps.
//
// Per-button override via data-dwell-ms="N" attribute. Defaults are
// generous on purpose — testers complained that 700ms felt instant once
// the cursor was already parked over the button area.
const TUT_DWELL_MS = 1500;          // GOT IT / START / NEXT default
const TUT_DWELL_COOLDOWN_MS = 500;  // post-click block, prevents chain-skip
let tutDwellState = { btn: null, startedAt: 0 };
let tutDwellCooldownUntil = 0;

function getDwellMsFor(btn) {
  const override = parseInt(btn?.dataset?.dwellMs ?? '', 10);
  return Number.isFinite(override) && override > 0 ? override : TUT_DWELL_MS;
}
function startTutCooldown() {
  tutDwellCooldownUntil = performance.now() + TUT_DWELL_COOLDOWN_MS;
}

function findOpenTutorial() {
  const isVisible = (el) => {
    if (!el) return false;
    if (el.style.display === 'none') return false;
    if (el.classList.contains('out')) return false;
    return getComputedStyle(el).display !== 'none';
  };
  // Modals block everything underneath; popovers don't (so the user
  // can actually interact with the UI the popover is teaching).
  // #perf-tutorial is shared by both — the welcome card uses .is-modal,
  // step cards use .is-popover, so we discriminate by class.
  const candidates = [
    { sel: '#intro-overlay',  modal: true  },
    { sel: '#perf-tutorial',  modal: 'auto' },
    { sel: '#onboard-step',   modal: false },
  ];
  for (const { sel, modal } of candidates) {
    const el = document.querySelector(sel);
    if (!isVisible(el)) continue;
    const btn = el.querySelector('[data-tutorial-dismiss]');
    if (!btn) continue;
    const isModal = modal === 'auto'
      ? el.classList.contains('is-modal')
      : modal;
    return { btn, el, modal: isModal };
  }
  return null;
}

function clearTutDwell() {
  if (tutDwellState.btn) {
    tutDwellState.btn.style.setProperty('--dwell-fill', '0%');
    tutDwellState.btn.classList.remove('hand-hover');
  }
  tutDwellState = { btn: null, startedAt: 0 };
}

function tutorialDwellTick(data) {
  // Returns true to ask main.js to SKIP the per-mode handFrame this
  // frame. Modals block; non-modal popovers (the onboarding step)
  // don't, so the user can keep interacting with the UI being taught.
  const open = findOpenTutorial();
  if (!open) { clearTutDwell(); return false; }
  const blocking = open.modal;

  const cursor = data?.right?.cursor || data?.left?.cursor;
  if (!cursor) { clearTutDwell(); return blocking; }

  // Resolve which dismiss button the cursor is actually over. Step
  // popovers have TWO buttons (Skip + Got It); elementFromPoint picks
  // the right one. Fall back to the first dismiss button in the
  // container so a parked cursor outside the buttons still trains
  // toward a sensible default — but only if the cursor is over the
  // tutorial container itself (we don't want to fire dismiss when the
  // cursor is wandering across the grid).
  const x = cursor.x * window.innerWidth;
  const y = cursor.y * window.innerHeight;
  const overEl = document.elementFromPoint(x, y);
  const btn = overEl?.closest('[data-tutorial-dismiss]') || null;

  // Post-click cooldown: a tutorial step just closed and the cursor is
  // probably still parked in the same spot. Refuse to start a fresh
  // dwell — or accept a pinch — until the user has had time to look at
  // the next step. Without this, hover-hold quietly chain-skips through
  // the whole tutorial.
  const now = performance.now();
  if (now < tutDwellCooldownUntil) {
    if (tutDwellState.btn) clearTutDwell();
    return blocking;
  }

  const pinching = data?.right?.pinchTriggered || data?.left?.pinchTriggered;
  if (btn && pinching) {
    btn.classList.add('pinch-flash');
    setTimeout(() => btn.classList.remove('pinch-flash'), 250);
    btn.click();
    clearTutDwell();
    startTutCooldown();
    return true;   // pinch over a tutorial button always wins
  }

  if (btn) {
    if (tutDwellState.btn !== btn) {
      clearTutDwell();
      tutDwellState = { btn, startedAt: now };
      btn.classList.add('hand-hover');
    }
    const dwellMs = getDwellMsFor(btn);
    const elapsed = now - tutDwellState.startedAt;
    const pct = Math.min(100, (elapsed / dwellMs) * 100);
    btn.style.setProperty('--dwell-fill', `${pct}%`);
    if (elapsed >= dwellMs) {
      btn.classList.add('pinch-flash');
      setTimeout(() => btn.classList.remove('pinch-flash'), 250);
      btn.click();
      clearTutDwell();
      startTutCooldown();
    }
    // While the cursor is actively dwelling on a dismiss button, block
    // the per-mode handFrame so we don't simultaneously click a button
    // underneath. Once it leaves, we yield back if we're a popover.
    return true;
  }
  if (tutDwellState.btn) clearTutDwell();
  return blocking;
}

const handTracker = new HandTracker({
  onStatus: setStatus,
  calibration,
  onFrame: (data) => {
    updateDebug(data);
    positionCursors(data);
    // Tutorial dwell takes precedence — if a modal is open it returns
    // true and we skip the per-mode handFrame so the cursor isn't
    // simultaneously dwelling on chord pads / grid cells underneath.
    const tutorialActive = tutorialDwellTick(data);
    if (tutorialActive) return;
    if (state.mode === 'create') sequencer.handFrame(data);
    else if (state.mode === 'performance') perfMode.handFrame(data);
    else freestyle.handFrame(data);
  },
});

handTracker.start().catch((err) => {
  console.warn('Hand tracking unavailable:', err);
  const slot = document.getElementById('webcam-slot');
  if (slot) slot.classList.add('disabled');
});

function paintCursor(el, hand) {
  if (!el) return;
  if (!hand?.cursor) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.left = `${hand.cursor.x * window.innerWidth}px`;
  el.style.top = `${hand.cursor.y * window.innerHeight}px`;
  el.classList.toggle('preview', hand.pinchState === 'preview');
  el.classList.toggle('ready', hand.pinchState === 'ready');
  el.classList.toggle('pinching', hand.pinchState === 'held' || hand.pinchState === 'triggered');
  el.classList.toggle('cooldown', hand.pinchState === 'cooldown');
}
function positionCursors(data) {
  paintCursor(cursorRightEl, data.right);
  paintCursor(cursorLeftEl, data.left);
  // Reset dwell ring on whichever cursor isn't actively dwelling.
  if (!data.right) cursorRightEl?.classList.remove('dwelling');
  if (!data.left) cursorLeftEl?.classList.remove('dwelling');
}

function updateDebug(data) {
  // Right-hand line shows what cell it's aiming at, in row/step terms,
  // plus its current pinch state. The right hand is the primary cursor
  // now, so we surface its pinch like we used to surface the left's.
  if (dbg.right) {
    const tgt = sequencer.getAimedTarget?.();
    if (tgt && data.right) {
      dbg.right.textContent = `target r${tgt.row}·s${tgt.col + 1} · ${leftPinchLabel(data.right.pinchState)}`;
    } else if (data.right) {
      dbg.right.textContent = `aim · ${leftPinchLabel(data.right.pinchState)} · t=${data.right.tipRatio?.toFixed(2)}`;
    } else {
      dbg.right.textContent = '—';
    }
  }
  // Left-hand line: optional second hand. Showed pinch state and the
  // calibrated start/end thresholds so testers can see why pinch fired
  // (or didn't) at any given moment.
  if (dbg.left) {
    if (data.left) {
      const r = data.left.pinchRatio?.toFixed(2);
      const e = data.left.pinchEndRatio?.toFixed(2);
      dbg.left.textContent = `pinch · ${leftPinchLabel(data.left.pinchState)} · t=${data.left.tipRatio?.toFixed(2)} (in<${r}, out>${e})`;
    } else {
      dbg.left.textContent = '—';
    }
  }

  const present = data.left || data.right;
  if (!present) {
    setHandStatus('SHOW YOUR HAND', 'warn');
    return;
  }
  const inTempo = state.mode === 'create' && sequencer.isTempoMode?.();
  if (inTempo) {
    setHandStatus('TEMPO · MOVE HAND UP/DOWN', 'good');
  } else if (data.right?.pinchState === 'triggered' || data.right?.pinchState === 'held') {
    setHandStatus('PINCH · PLACED', 'good');
  } else if (data.right) {
    setHandStatus('AIM · PINCH TO PLACE', 'good');
  } else if (data.left && !data.right) {
    // Right hand is preferred for aiming, but if only the left is up we
    // don't block the experience — let the user keep going.
    setHandStatus('SHOW RIGHT HAND TO AIM', 'warn');
  } else {
    setHandStatus('READY', '');
  }
}

async function ensureAudioStarted() {
  if (state.audioStarted) return;
  try {
    await audio.start();
    state.audioStarted = true;
  } catch (e) {
    console.warn('Audio failed to start:', e);
    setStatus('click anywhere to start audio');
  }
}

function switchMode(next) {
  // Stash create-mode onboarding when the user leaves so its popover
  // doesn't bleed onto the freestyle / performance screens. We only
  // hide the visual; if they come back to create the controller is
  // still in the right step, so we re-render it on return.
  if (state.mode === 'create' && next !== 'create' && onboarding.active) {
    hideStep();
  } else if (next === 'create' && onboarding.active && onboarding.stepIdx >= 0) {
    renderStep(onboarding.stepIdx);
  }
  state.mode = next;
  document.body.classList.toggle('mode-create', next === 'create');
  document.body.classList.toggle('mode-performance', next === 'performance');
  // Freestyle controls its own sub-phase body class
  // (mode-freestyle / mode-freestyle-setup / mode-freestyle-countdown).
  // Just clear them when leaving freestyle.
  if (next !== 'freestyle') {
    document.body.classList.remove('mode-freestyle', 'mode-freestyle-setup', 'mode-freestyle-countdown');
  }
  document.getElementById('screen-create').classList.toggle('active', next === 'create');
  document.getElementById('screen-freestyle').classList.toggle('active', next === 'freestyle');
  document.getElementById('screen-performance').classList.toggle('active', next === 'performance');
  if (next === 'freestyle') {
    ensureAudioStarted().then(() => freestyle.start());
  } else if (next === 'performance') {
    ensureAudioStarted().then(() => perfMode.start());
  }
}

// Keyboard fallback. Space toggles transport in either mode so the loop
// keeps moving even without hand tracking.
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    ensureAudioStarted();
    if (state.mode === 'create') {
      sequencer.toggleTransport();
    } else {
      sequencer.ensurePlaying();
    }
  }
});

window.addEventListener('pointerdown', () => {
  ensureAudioStarted();
});
