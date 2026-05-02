import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

// Pinch hysteresis: tighter threshold to ENTER pinch, looser to EXIT.
// Without a separate end threshold, fingertips hovering near the boundary
// flicker between pinch/no-pinch and the user has to "find" the gesture.
const PINCH_HOLD_MS = 140;
const PINCH_COOLDOWN_MS = 350;
const DEFAULT_PINCH_RATIO = 0.42;
const DEFAULT_END_RATIO = 0.58;       // must spread back this far to release
const DEFAULT_PREVIEW_RATIO = 0.72;
const PINCH_INDEX_EXT_MIN = 0.62;     // require a clearly-extended index
const PINCH_THUMB_OUT_MIN = 0.40;     // thumb tip must be away from palm
const FIST_CURL_RATIO = 0.45;

// EMA alpha for cursor smoothing (higher = more responsive, less smoothing).
const CURSOR_SMOOTHING = 0.45;

// MediaPipe reports handedness from the *user's* perspective even in selfie
// view. If real-world testing shows it inverted, flip this.
const FLIP_HANDEDNESS = true;

export class Calibration {
  constructor() {
    this.calibrating = false;
    this.samples = [];
    this.startTime = 0;
    this.calibrated = false;
    this.openSpread = null;
    this.pinchRatio = DEFAULT_PINCH_RATIO;
    this.endRatio = DEFAULT_END_RATIO;
    this.previewRatio = DEFAULT_PREVIEW_RATIO;
    this.lastResult = null;
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify(payload) { for (const fn of this.listeners) fn(payload); }

  begin() {
    this.calibrating = true;
    this.samples = [];
    this.startTime = performance.now();
    this.notify({ kind: 'started' });
  }

  cancel() {
    this.calibrating = false;
    this.samples = [];
    this.notify({ kind: 'cancelled' });
  }

  feed({ tipRatio, isOpenHand }) {
    if (!this.calibrating) return;
    const elapsed = performance.now() - this.startTime;
    if (isOpenHand) this.samples.push(tipRatio);

    if (elapsed >= 1000 && this.samples.length >= 6) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      this.openSpread = median;
      this.pinchRatio = clamp(median * 0.32, 0.30, 0.55);
      this.endRatio = clamp(this.pinchRatio + 0.16, 0.46, 0.75);
      this.previewRatio = clamp(median * 0.55, 0.55, 0.90);
      this.calibrated = true;
      this.calibrating = false;
      const result = { kind: 'done', openSpread: median, pinchRatio: this.pinchRatio };
      this.lastResult = result;
      this.notify(result);
      return;
    }
    if (elapsed >= 2500) {
      this.calibrating = false;
      const result = { kind: 'failed' };
      this.lastResult = result;
      this.notify(result);
      return;
    }
    this.notify({ kind: 'progress', progress: Math.min(1, elapsed / 1000), samples: this.samples.length });
  }
}

class PinchDetector {
  constructor() {
    this.pinchStart = null;
    this.triggered = false;
    this.cooldownUntil = 0;
    this.state = 'idle';
  }

  update({ tipRatio, fistLike, now, pinchRatio, endRatio, previewRatio }) {
    const inCooldown = now < this.cooldownUntil;

    if (fistLike) {
      this.pinchStart = null;
      this.triggered = false;
      this.state = inCooldown ? 'cooldown' : 'idle';
      return { state: this.state, justTriggered: false, holdProgress: 0 };
    }

    // Hysteresis: once we're "held", the user has to spread the fingers
    // back past the (looser) endRatio to release. This is what kills the
    // flicker around the pinch boundary.
    const isClose = tipRatio < pinchRatio;
    const stillHolding = this.triggered && tipRatio < endRatio;
    const isPreview = tipRatio < previewRatio;

    if (isClose || stillHolding) {
      if (this.pinchStart === null) this.pinchStart = now;
      const dur = now - this.pinchStart;
      const holdProgress = Math.min(1, dur / PINCH_HOLD_MS);

      if (!this.triggered && !inCooldown && dur >= PINCH_HOLD_MS) {
        this.triggered = true;
        this.cooldownUntil = now + PINCH_COOLDOWN_MS;
        this.state = 'triggered';
        return { state: 'triggered', justTriggered: true, holdProgress: 1 };
      }
      if (this.triggered) {
        this.state = 'held';
        return { state: 'held', justTriggered: false, holdProgress: 1 };
      }
      this.state = 'ready';
      return { state: 'ready', justTriggered: false, holdProgress };
    }

    // Spread back open — clear any held state cleanly so the next pinch
    // has to re-clear the tighter start threshold.
    if (isPreview && !inCooldown && !this.triggered) {
      this.pinchStart = null;
      this.state = 'preview';
      return { state: 'preview', justTriggered: false, holdProgress: 0 };
    }

    this.pinchStart = null;
    this.triggered = false;
    this.state = inCooldown ? 'cooldown' : 'idle';
    return { state: this.state, justTriggered: false, holdProgress: 0 };
  }

  reset(now) {
    this.pinchStart = null;
    this.triggered = false;
    this.state = now < this.cooldownUntil ? 'cooldown' : 'idle';
  }
}

// Lightweight per-hand state (cursor smoothing + pinch detection).
class HandSlot {
  constructor() {
    this.pinch = new PinchDetector();
    this.smoothed = null;
    this.lastSeenAt = 0;
  }
  smooth(raw) {
    if (!this.smoothed) {
      this.smoothed = { x: raw.x, y: raw.y };
    } else {
      const a = CURSOR_SMOOTHING;
      this.smoothed.x = this.smoothed.x * (1 - a) + raw.x * a;
      this.smoothed.y = this.smoothed.y * (1 - a) + raw.y * a;
    }
    return { x: this.smoothed.x, y: this.smoothed.y };
  }
}

export class HandTracker {
  constructor({ onStatus, onFrame, calibration }) {
    this.onStatus = onStatus;
    this.onFrame = onFrame;
    this.calibration = calibration || new Calibration();
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.running = false;

    this.slots = { Left: new HandSlot(), Right: new HandSlot() };
    this.lastPresent = false;
  }

  async start() {
    this.onStatus('Loading hand tracking…');

    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.id = 'webcam-video';

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'webcam-canvas';
    this.ctx = this.canvas.getContext('2d');

    const slot = document.getElementById('webcam-slot');
    if (slot) {
      slot.prepend(this.canvas);
      slot.prepend(this.video);
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      this.onStatus('Webcam unavailable — keyboard fallback enabled.');
      throw err;
    }

    this.video.srcObject = stream;
    await new Promise((res) => {
      this.video.onloadedmetadata = () => {
        this.video.play();
        res();
      };
    });

    this.canvas.width = this.video.videoWidth || 640;
    this.canvas.height = this.video.videoHeight || 480;

    try {
      const fileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      // numHands: 2 — Create Mode wants the right hand for grid and the left
      // hand for tempo, so we always track both.
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });
    } catch (err) {
      this.onStatus('Hand tracking failed — keyboard fallback enabled.');
      throw err;
    }

    this.onStatus('Show your hands to the camera.');
    this.running = true;
    this.loop();
  }

  loop = () => {
    if (!this.running) return;
    if (this.video && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      try {
        const result = this.landmarker.detectForVideo(this.video, performance.now());
        this.draw(result);
        this.handle(result);
      } catch (err) {
        console.warn('hand detect error', err);
      }
    }
    requestAnimationFrame(this.loop);
  };

  draw(result) {
    const c = this.ctx;
    if (!c) return;
    c.save();
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.translate(this.canvas.width, 0);
    c.scale(-1, 1);

    if (result.landmarks?.length) {
      for (let i = 0; i < result.landmarks.length; i++) {
        const lm = result.landmarks[i];
        const handedRaw = result.handednesses?.[i]?.[0]?.categoryName;
        const handed = FLIP_HANDEDNESS
          ? (handedRaw === 'Left' ? 'Right' : 'Left')
          : handedRaw;
        const color = handed === 'Left' ? '#ff5cf3' : '#5ce8ff';
        c.strokeStyle = color;
        c.lineWidth = 2.5;
        for (const [a, b] of HAND_CONNECTIONS) {
          c.beginPath();
          c.moveTo(lm[a].x * this.canvas.width, lm[a].y * this.canvas.height);
          c.lineTo(lm[b].x * this.canvas.width, lm[b].y * this.canvas.height);
          c.stroke();
        }
        c.fillStyle = color;
        for (const p of lm) {
          c.beginPath();
          c.arc(p.x * this.canvas.width, p.y * this.canvas.height, 3.5, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = '#ffe14d';
        c.beginPath();
        c.arc(lm[8].x * this.canvas.width, lm[8].y * this.canvas.height, 8, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }

  handle(result) {
    const now = performance.now();
    const hands = { Left: null, Right: null };

    if (result.landmarks?.length) {
      // Step 1 — collect every candidate w/ its cursor x (mirror-corrected).
      const detected = [];
      for (let i = 0; i < result.landmarks.length; i++) {
        const lm = result.landmarks[i];
        const rawHandedness = result.handednesses?.[i]?.[0]?.categoryName ?? 'Right';
        const score = result.handednesses?.[i]?.[0]?.score ?? 0;
        const cursorX = 1 - lm[8].x;       // index fingertip, mirror-flipped
        detected.push({ lm, rawHandedness, score, cursorX });
      }

      // Step 2 — assign each candidate to a side.
      // Preferred: MediaPipe handedness (with FLIP_HANDEDNESS interpretation).
      // Fallback when both hands are seen but labels match: sort by screen X
      // — the hand on the right side of the screen is the aim hand. This
      // matches user intuition better than a noisy handedness call.
      const labelOf = (raw) => FLIP_HANDEDNESS
        ? (raw === 'Left' ? 'Right' : 'Left')
        : raw;

      if (detected.length >= 2) {
        // When both hands are visible, screen position is the most reliable
        // signal (MediaPipe handedness can be inverted by selfie-camera
        // mirroring or just be noisy). Right-side cursor = aiming hand.
        const byX = [...detected].sort((x, y) => y.cursorX - x.cursorX);
        hands.Right = byX[0];
        hands.Left  = byX[1];
      } else if (detected.length === 1) {
        const c = detected[0];
        hands[labelOf(c.rawHandedness)] = c;
      }

      // Step 3 — turn each assigned candidate into a Hand object using its
      // per-side slot for cursor smoothing and pinch detection.
      for (const side of ['Left', 'Right']) {
        const c = hands[side];
        if (!c) continue;
        const lm = c.lm;
        const slot = this.slots[side];
        const palm = palmLength(lm);
        const tipDist = dist(lm[4], lm[8]);
        const tipRatio = tipDist / palm;
        const indexExt = dist(lm[8], lm[5]) / palm;
        const thumbOut = dist(lm[4], lm[0]) / palm;
        // Pinch is only a "pinch" if the index finger is clearly extended
        // toward the thumb AND the thumb itself is held away from the palm.
        // A loose curl looks like a tiny tipDist but isn't a pinch.
        const fistLike = isFistLike(lm, palm)
          || indexExt < PINCH_INDEX_EXT_MIN
          || thumbOut < PINCH_THUMB_OUT_MIN;
        const gesture = classifyGesture(lm);

        if (this.calibration.calibrating) {
          this.calibration.feed({ tipRatio, isOpenHand: gesture === 'palm' });
        }

        const pinchResult = slot.pinch.update({
          tipRatio,
          fistLike,
          now,
          pinchRatio: this.calibration.pinchRatio,
          endRatio: this.calibration.endRatio,
          previewRatio: this.calibration.previewRatio,
        });

        const rawCursor = { x: c.cursorX, y: lm[8].y };
        const smoothed = slot.smooth(rawCursor);
        slot.lastSeenAt = now;

        hands[side] = {
          landmarks: lm,
          handedness: side,
          rawHandedness: c.rawHandedness,
          assignmentSource: detected.length >= 2 ? 'auto' : 'label',
          gesture,
          cursor: smoothed,
          rawCursor,
          pinchState: pinchResult.state,
          pinchTriggered: pinchResult.justTriggered,
          pinchHoldProgress: pinchResult.holdProgress,
          tipRatio,
          pinchRatio: this.calibration.pinchRatio,
          pinchEndRatio: this.calibration.endRatio,
          indexExt,
          thumbOut,
        };
      }
    }

    // Reset detectors / smoothing for any side that disappeared this frame.
    for (const side of ['Left', 'Right']) {
      if (!hands[side]) {
        this.slots[side].pinch.reset(now);
        this.slots[side].smoothed = null;
      }
    }

    const present = !!(hands.Left || hands.Right);
    if (present !== this.lastPresent) {
      this.lastPresent = present;
      this.onStatus(present ? 'Hand detected.' : 'Show your hands to the camera.');
    }

    // Pick a primary hand for legacy single-cursor consumers (Freestyle Mode).
    // Prefer Right (dominant), fall back to Left.
    const primary = hands.Right ?? hands.Left ?? null;

    this.onFrame({
      hand: primary,
      left: hands.Left,
      right: hands.Right,
    });
  }

  stop() {
    this.running = false;
    if (this.video?.srcObject) {
      for (const track of this.video.srcObject.getTracks()) track.stop();
    }
  }
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function palmLength(lm) { return dist(lm[0], lm[9]); }

function fingerExtended(lm, tip, pip) {
  const wrist = lm[0];
  return dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.1;
}

function isFistLike(lm, palm) {
  const indexCurled = dist(lm[8], lm[5]) / palm < FIST_CURL_RATIO + 0.1;
  const middleCurled = dist(lm[12], lm[9]) / palm < FIST_CURL_RATIO;
  const ringCurled = dist(lm[16], lm[13]) / palm < FIST_CURL_RATIO;
  const pinkyCurled = dist(lm[20], lm[17]) / palm < FIST_CURL_RATIO;
  return indexCurled && middleCurled && ringCurled && pinkyCurled;
}

export function classifyGesture(lm) {
  const indexExt = fingerExtended(lm, 8, 6);
  const middleExt = fingerExtended(lm, 12, 10);
  const ringExt = fingerExtended(lm, 16, 14);
  const pinkyExt = fingerExtended(lm, 20, 18);
  const extCount = [indexExt, middleExt, ringExt, pinkyExt].filter(Boolean).length;

  if (indexExt && !middleExt && !ringExt && !pinkyExt) return 'point';
  if (extCount >= 4) return 'palm';
  if (extCount === 0) return 'fist';
  return 'none';
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
