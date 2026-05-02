import * as Tone from 'tone';

const TRACK_LABELS = {
  hihat: 'HI-HAT',
  clap: 'CLAP',
  snare: 'SNARE',
  kick: 'KICK',
};

const TRACK_COLORS = {
  hihat: '#ffe14d',
  clap: '#7cff7c',
  snare: '#5ce8ff',
  kick: '#ff5cf3',
};

const DWELL_MS = 700;
const TEMPO_MIN = 70;
const TEMPO_MAX = 150;
// Y-deadzone fraction at top/bottom of frame for tempo control — so the
// extremes are reachable without users needing to push their hand off-screen.
const TEMPO_Y_HEAD = 0.10;
const TEMPO_Y_TAIL = 0.90;

export class Sequencer {
  constructor({ root, tracks, steps, pattern, audio,
    onCellToggle, onPlay, onStop, onClear, onGoToFreestyle, onGoToPerformance, onStep, onEnterTempoMode,
    getBpm, setBpm, setDwellProgress }) {
    this.root = root;
    this.tracks = tracks;
    this.steps = steps;
    this.pattern = pattern;
    this.audio = audio;
    this.onCellToggle = onCellToggle;
    this.onPlay = onPlay;
    this.onStop = onStop;
    this.onClear = onClear;
    this.onGoToFreestyle = onGoToFreestyle;
    this.onGoToPerformance = onGoToPerformance || (() => {});
    this.onStep = onStep || (() => {});
    this.onEnterTempoMode = onEnterTempoMode || (() => {});
    this.getBpm = getBpm || (() => 100);
    this.setBpm = setBpm || (() => {});
    this.setDwellProgress = setDwellProgress || (() => {});

    this.playhead = -1;
    this.playing = false;

    // Right-hand state.
    this.dwellEl = null;
    this.dwellStart = 0;
    this.frozen = null;
    this.aimedCell = null;

    // Tempo Mode state.
    this.tempoMode = false;
  }

  mount() {
    this.root.innerHTML = `
      <div class="create-layout">
        <div class="grid-panel">
          <div class="panel-meta">
            <span class="meta-label">SEQUENCER · 4 × 8</span>
          </div>

          <div class="grid-and-tempo">
            <!-- left column: grid + buttons -->
            <div class="grid-column">
              <!-- Contextual targeting readout. Empty when nothing is aimed;
                   the persistent how-to lives in the left webcam panel. -->
              <div id="aim-tooltip" class="aim-tooltip"></div>

              <div id="beat-grid" class="beat-grid"></div>

              <div class="controls">
                <button id="btn-play" class="btn primary big" data-pinch>PLAY</button>
                <button id="btn-stop" class="btn big" data-pinch>STOP</button>
                <button id="btn-clear" class="btn big" data-pinch>CLEAR</button>
                <button id="btn-freestyle" class="btn accent big" data-pinch>FREESTYLE →</button>
                <button id="btn-performance" class="btn experimental big" data-pinch>
                  TRY PERFORMANCE <span class="exp-tag">EXPERIMENTAL</span>
                </button>
              </div>

              <div class="action-feedback" id="action-feedback"></div>
            </div>

            <!-- right column: inline vertical tempo panel -->
            <aside class="tempo-panel" id="tempo-panel" aria-label="Tempo">
              <div class="tempo-panel-header">
                <span class="tempo-panel-label">BPM</span>
                <div class="tempo-panel-value" id="tempo-panel-value">100</div>
              </div>

              <button id="btn-tempo-adjust" class="btn tempo-pad adjust" data-pinch>
                ADJUST<br/>TEMPO
              </button>

              <div class="tempo-rail" id="tempo-rail" aria-hidden="true">
                <span class="tempo-rail-tick" data-bpm="150"></span>
                <span class="tempo-rail-tick" data-bpm="130"></span>
                <span class="tempo-rail-tick mid" data-bpm="110"></span>
                <span class="tempo-rail-tick" data-bpm="90"></span>
                <span class="tempo-rail-tick" data-bpm="70"></span>
                <span class="tempo-rail-line"></span>
                <span class="tempo-rail-knob" id="tempo-rail-knob"></span>
              </div>

              <button id="btn-tempo-set" class="btn tempo-pad set" data-pinch>SET</button>

              <div class="tempo-fallback" aria-hidden="true">
                <button id="btn-bpm-down" class="btn-mini" type="button" title="−5 BPM">−</button>
                <button id="btn-bpm-up" class="btn-mini" type="button" title="+5 BPM">+</button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    `;

    this.gridEl       = this.root.querySelector('#beat-grid');
    this.tempoPanel   = this.root.querySelector('#tempo-panel');
    this.tempoBtn     = this.root.querySelector('#btn-tempo-adjust');
    this.tempoSetBtn  = this.root.querySelector('#btn-tempo-set');
    this.tempoValue   = this.root.querySelector('#tempo-panel-value');
    this.tempoKnob    = this.root.querySelector('#tempo-rail-knob');
    this.feedbackEl   = this.root.querySelector('#action-feedback');
    this.aimTooltipEl = this.root.querySelector('#aim-tooltip');

    this.root.querySelector('#btn-play').addEventListener('click', () => this.onPlay());
    this.root.querySelector('#btn-stop').addEventListener('click', () => this.onStop());
    this.root.querySelector('#btn-clear').addEventListener('click', () => this.onClear());
    this.root.querySelector('#btn-freestyle').addEventListener('click', () => this.onGoToFreestyle());
    this.root.querySelector('#btn-performance')?.addEventListener('click', () => this.onGoToPerformance());

    this.tempoBtn.addEventListener('click', () => this.enterTempoMode());
    this.tempoSetBtn.addEventListener('click', () => this.exitTempoMode());

    this.root.querySelector('#btn-bpm-down').addEventListener('click', () => {
      this.setBpm(Math.max(TEMPO_MIN, this.getBpm() - 5));
      this.showFeedback(`${this.getBpm()} BPM`);
    });
    this.root.querySelector('#btn-bpm-up').addEventListener('click', () => {
      this.setBpm(Math.min(TEMPO_MAX, this.getBpm() + 5));
      this.showFeedback(`${this.getBpm()} BPM`);
    });

    this.render();
    this.updateTempo(this.getBpm());
    this.updateTempoModeUI();
  }

  showFeedback(text, kind = 'info') {
    if (!this.feedbackEl) return;
    this.feedbackEl.textContent = text;
    this.feedbackEl.className = `action-feedback show ${kind}`;
    clearTimeout(this._fadeTimer);
    this._fadeTimer = setTimeout(() => {
      this.feedbackEl.classList.remove('show');
    }, 1400);
  }

  updateTempo(bpm) {
    if (this.tempoValue) this.tempoValue.textContent = String(bpm);
    if (this.tempoKnob) {
      const ratio = (bpm - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN); // 0..1
      // Vertical rail: top = high BPM, bottom = low BPM. ratio=1 → top:0%
      const topPct = (1 - ratio) * 100;
      this.tempoKnob.style.top = `${topPct}%`;
    }
  }

  updateTempoModeUI() {
    if (!this.tempoPanel) return;
    this.tempoPanel.classList.toggle('active', this.tempoMode);
    this.tempoBtn?.classList.toggle('on', this.tempoMode);
    this.tempoSetBtn?.classList.toggle('ready', this.tempoMode);
  }

  render() {
    if (!this.gridEl) return;
    if (this.gridEl.children.length === 0) {
      for (let r = 0; r < this.tracks.length; r++) {
        const row = document.createElement('div');
        row.className = 'beat-row';
        const label = document.createElement('div');
        label.className = 'row-label';
        label.style.color = TRACK_COLORS[this.tracks[r]];
        label.textContent = TRACK_LABELS[this.tracks[r]];
        row.appendChild(label);
        for (let c = 0; c < this.steps; c++) {
          const cell = document.createElement('button');
          cell.className = 'cell';
          cell.dataset.row = r;
          cell.dataset.col = c;
          cell.style.setProperty('--track-color', TRACK_COLORS[this.tracks[r]]);
          if ((c % 4) === 0) cell.classList.add('downbeat');
          // Mouse fallback toggle.
          cell.addEventListener('click', () => this.onCellToggle(r, c, 'mouse'));
          row.appendChild(cell);
        }
        this.gridEl.appendChild(row);
      }
    }
    const rows = this.gridEl.querySelectorAll('.beat-row');
    for (let r = 0; r < this.tracks.length; r++) {
      const cells = rows[r].querySelectorAll('.cell');
      for (let c = 0; c < this.steps; c++) {
        const cell = cells[c];
        cell.classList.toggle('on', !!this.pattern[r][c]);
        cell.classList.toggle('playhead', this.playhead === c);
      }
    }
  }

  toggleTransport() {
    if (this.playing) this.stop();
    else this.onPlay();
  }

  ensurePlaying() {
    if (!this.playing) this.play();
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    Tone.Transport.bpm.value = this.getBpm();
    this.loop = new Tone.Sequence(
      (time, s) => {
        Tone.Draw.schedule(() => {
          this.playhead = s;
          this.render();
          this.onStep(s, time);
        }, time);
        for (let r = 0; r < this.tracks.length; r++) {
          if (this.pattern[r][s]) this.audio.trigger(this.tracks[r], time);
        }
      },
      [...Array(this.steps).keys()],
      '8n'
    ).start(0);
    Tone.Transport.start();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    if (this.loop) {
      this.loop.stop();
      this.loop.dispose();
      this.loop = null;
    }
    Tone.Transport.stop();
    Tone.Transport.cancel();
    this.playhead = -1;
    this.render();
  }

  // Public — main.js reads this for the debug label.
  getAimedTarget() {
    if (!this.aimedCell) return null;
    return {
      row: +this.aimedCell.dataset.row,
      col: +this.aimedCell.dataset.col,
    };
  }
  isTempoMode() { return this.tempoMode; }

  // ---------- Tempo Mode ----------
  enterTempoMode() {
    if (this.tempoMode) return;
    this.tempoMode = true;
    this.clearAimedCell();
    this.updateTempoModeUI();
    this.updateTempo(this.getBpm());
    this.showFeedback('TEMPO · raise hand for faster', 'good');
    this.onEnterTempoMode();
  }

  exitTempoMode() {
    if (!this.tempoMode) return;
    this.tempoMode = false;
    this.updateTempoModeUI();
    this.updateTempo(this.getBpm());
    this.showFeedback(`TEMPO SET · ${this.getBpm()} BPM`, 'good');
  }

  // ---------- Per-frame routing ----------
  // Right hand is the primary cursor: aims grid, hovers/dwells buttons,
  // pinches to place beats. Left hand is supplemental — its pinch can
  // also place a beat, and in Tempo Mode it owns BPM if it's visible.
  // Critically: nothing here REQUIRES the left hand to be in frame.
  handFrame(data) {
    if (!data) return;
    const now = performance.now();

    const right = data.right;
    const left  = data.left;

    this.handleRightHand(right, now);
    this.handleLeftHand(left, now);

    // Tempo fallback: if Tempo Mode is on and only the right hand is
    // visible, drive BPM from the right-hand Y. The right-hand routing
    // above already clears aimedCell when in tempo mode, so its X/Y
    // doesn't conflict.
    if (this.tempoMode && right?.cursor && !left?.cursor) {
      const newBpm = bpmFromY(right.cursor.y);
      if (newBpm !== this.getBpm()) {
        this.setBpm(newBpm);
        this.updateTempo(newBpm);
      }
    }
  }

  handleRightHand(right, now) {
    if (!right?.cursor) {
      this.dwellEl = null;
      this.frozen = null;
      this.setDwellProgress(0);
      this.clearAimedCell();
      this.updateHover(null);
      return;
    }
    const x = right.cursor.x * window.innerWidth;
    const y = right.cursor.y * window.innerHeight;
    const el = document.elementFromPoint(x, y);

    // Aim a grid cell — except in Tempo Mode (left hand owns BPM there).
    if (!this.tempoMode) {
      const cellTarget = el?.closest('.cell');
      this.setAimedCell(cellTarget);
    } else {
      this.clearAimedCell();
    }

    // Buttons — right pinch confirms instantly OR hover-dwell fills.
    const btnTarget = el?.closest('.btn, .btn-mini');
    this.updateHover(btnTarget || null);

    if (right.pinchTriggered && btnTarget) {
      btnTarget.click();
      btnTarget.classList.add('pinch-flash');
      setTimeout(() => btnTarget.classList.remove('pinch-flash'), 250);
      this.frozen = btnTarget;
      this.dwellEl = null;
      this.setDwellProgress(0);
      return;
    }

    // Right-pinch over an aimed grid cell places/removes a beat — no left
    // hand required. Left pinch still works (handled in handleLeftHand).
    if (right.pinchTriggered && this.aimedCell && !this.tempoMode) {
      const r = +this.aimedCell.dataset.row;
      const c = +this.aimedCell.dataset.col;
      const flashed = this.aimedCell;
      this.onCellToggle(r, c, 'right-pinch');
      const isOn = !!this.pattern[r][c];
      flashed.classList.add('pinch-flash');
      setTimeout(() => flashed.classList.remove('pinch-flash'), 250);
      this.showFeedback(isOn ? 'PLACED' : 'REMOVED', 'good');
      return;
    }

    if (btnTarget !== this.frozen) this.frozen = null;

    if (btnTarget && !this.frozen) {
      if (this.dwellEl !== btnTarget) {
        this.dwellEl = btnTarget;
        this.dwellStart = now;
      }
      const elapsed = now - this.dwellStart;
      const pct = Math.min(100, (elapsed / DWELL_MS) * 100);
      this.setDwellProgress(pct);
      btnTarget.style.setProperty('--dwell-fill', `${pct}%`);
      if (elapsed >= DWELL_MS) {
        btnTarget.click();
        btnTarget.classList.add('pinch-flash');
        setTimeout(() => btnTarget.classList.remove('pinch-flash'), 250);
        this.frozen = btnTarget;
        this.dwellEl = null;
        this.setDwellProgress(0);
        btnTarget.style.setProperty('--dwell-fill', '0%');
      }
    } else {
      if (this.dwellEl) this.dwellEl.style.setProperty('--dwell-fill', '0%');
      this.dwellEl = null;
      this.setDwellProgress(0);
    }
  }

  handleLeftHand(left, now) {
    if (!left?.cursor) return;

    // Tempo Mode: left-hand y → BPM 70..150 (top is faster).
    if (this.tempoMode) {
      const newBpm = bpmFromY(left.cursor.y);
      if (newBpm !== this.getBpm()) {
        this.setBpm(newBpm);
        this.updateTempo(newBpm);
      }
      return;
    }

    // Not tempo mode: left pinch confirms placement at the right-hand-aimed
    // cell. Cell must have been aimed by the right hand — left-hand position
    // never matters for which cell gets toggled.
    if (!left.pinchTriggered) return;

    if (this.aimedCell) {
      const r = +this.aimedCell.dataset.row;
      const c = +this.aimedCell.dataset.col;
      const flashed = this.aimedCell;
      // The shared pattern is updated synchronously in onCellToggle, so we
      // can read the new state right after to decide the verb.
      this.onCellToggle(r, c, 'left-pinch');
      const isOn = !!this.pattern[r][c];
      flashed.classList.add('pinch-flash');
      setTimeout(() => flashed.classList.remove('pinch-flash'), 250);
      this.showFeedback(isOn ? 'PLACED' : 'REMOVED', 'good');
    } else {
      this.showFeedback('AIM A SQUARE WITH RIGHT HAND');
    }
  }

  setAimedCell(cell) {
    if (cell === this.aimedCell) return;
    this.aimedCell?.classList.remove('aimed');
    this.aimedCell = cell || null;
    this.aimedCell?.classList.add('aimed');
    this.updateAimTooltip();
  }
  clearAimedCell() {
    if (this.aimedCell) {
      this.aimedCell.classList.remove('aimed');
      this.aimedCell = null;
    }
    this.updateAimTooltip();
  }
  updateAimTooltip() {
    if (!this.aimTooltipEl) return;
    if (!this.aimedCell) {
      this.aimTooltipEl.textContent = 'Hover a square with your right hand. Pinch to place.';
      this.aimTooltipEl.classList.remove('on');
      return;
    }
    const r = +this.aimedCell.dataset.row;
    const c = +this.aimedCell.dataset.col;
    const trackName = TRACK_LABELS[this.tracks[r]] || this.tracks[r];
    this.aimTooltipEl.textContent = `Targeting: ${trackName}, Step ${c + 1}`;
    this.aimTooltipEl.classList.add('on');
  }

  updateHover(target) {
    if (target !== this.lastHover) {
      this.lastHover?.classList.remove('hand-hover');
      target?.classList.add('hand-hover');
      this.lastHover = target;
    }
  }
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function bpmFromY(yRaw) {
  const ratio = clamp01(1 - (yRaw - TEMPO_Y_HEAD) / (TEMPO_Y_TAIL - TEMPO_Y_HEAD));
  return Math.round(TEMPO_MIN + ratio * (TEMPO_MAX - TEMPO_MIN));
}
