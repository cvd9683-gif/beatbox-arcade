import * as Tone from 'tone';

// Synthesized drum sounds. Audio context is started lazily in start() because
// browsers require an audio context to begin from a user gesture.
export class AudioEngine {
  constructor() {
    this.started = false;
  }

  async start() {
    if (this.started) return;
    await Tone.start();

    // Master bus with a touch of compression so peaks don't clip on layered hits.
    this.master = new Tone.Compressor(-12, 3).toDestination();
    this.master.connect(Tone.getDestination());

    // Kick: low punchy membrane synth pitching down quickly.
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.35, sustain: 0.01, release: 1.2 },
    }).connect(this.master);
    this.kick.volume.value = -2;

    // Snare: noise body + a short tonal layer for snap.
    this.snareNoise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
    }).connect(this.master);
    this.snareNoise.volume.value = -6;
    this.snareTone = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 },
    }).connect(this.master);
    this.snareTone.volume.value = -14;

    // Hi-hat: high-passed noise burst.
    const hhFilter = new Tone.Filter(7000, 'highpass').connect(this.master);
    this.hihat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
    }).connect(hhFilter);
    this.hihat.volume.value = -10;

    // Clap: band-passed pink noise, retriggered for a layered slap.
    const clapFilter = new Tone.Filter(1500, 'bandpass').connect(this.master);
    clapFilter.Q.value = 1.2;
    this.clap = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.002, decay: 0.18, sustain: 0 },
    }).connect(clapFilter);
    this.clap.volume.value = -8;

    this.started = true;
  }

  trigger(name, time) {
    if (!this.started) return;
    const t = time ?? Tone.now();
    switch (name) {
      case 'kick':
        this.kick.triggerAttackRelease('C1', '8n', t);
        break;
      case 'snare':
        this.snareNoise.triggerAttackRelease('16n', t);
        this.snareTone.triggerAttackRelease('A3', '32n', t);
        break;
      case 'hihat':
        this.hihat.triggerAttackRelease('32n', t);
        break;
      case 'clap':
        this.clap.triggerAttackRelease('16n', t);
        this.clap.triggerAttackRelease('16n', t + 0.025);
        break;
    }
  }
}
