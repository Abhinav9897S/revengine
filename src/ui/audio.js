// Synthesised engine sounds (Web Audio, no sound files needed).
export class EngineAudio {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.7 : 0;
  }

  noise(seconds = 2) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  /** profile: { cyl, layout, diesel } */
  rev(profile = {}) {
    if (!this.enabled) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.03;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(0.32, t0 + 0.08);
    out.gain.setValueAtTime(0.32, t0 + 1.25);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.7);
    out.connect(this.master);

    if (profile.layout === 'EV') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5000;
      lp.connect(out);
      [1, 2.01, 3.5].forEach((m, i) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        const g = ctx.createGain();
        g.gain.value = [0.35, 0.12, 0.05][i];
        o.frequency.setValueAtTime(180 * m, t0);
        o.frequency.exponentialRampToValueAtTime(1500 * m, t0 + 1.1);
        o.frequency.exponentialRampToValueAtTime(300 * m, t0 + 2.6);
        o.connect(g).connect(lp);
        o.start(t0);
        o.stop(t0 + 2.8);
      });
      const n = this.noise(3);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2500;
      const ng = ctx.createGain();
      ng.gain.value = 0.04;
      n.connect(bp).connect(ng).connect(out);
      n.start(t0);
      n.stop(t0 + 2.8);
      return;
    }

    const cyl = profile.cyl || 8;
    const maxRpm = profile.diesel ? 4300 : cyl >= 12 ? 8600 : cyl >= 8 ? 7600 : 7000;
    const k = cyl / 120; // firing frequency (Hz) per rpm
    const idle = profile.diesel ? 800 : 1000;

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    const drive = profile.diesel ? 6 : cyl >= 12 ? 2.5 : 4;
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * drive); }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(500, t0);
    lp.frequency.exponentialRampToValueAtTime(cyl >= 12 ? 5200 : 3600, t0 + 0.95);
    lp.frequency.exponentialRampToValueAtTime(600, t0 + 2.4);
    const body = ctx.createGain();
    body.gain.value = 0.5;
    shaper.connect(lp).connect(body).connect(out);

    const ramp = (param, mul) => {
      param.setValueAtTime(idle * k * mul, t0);
      param.exponentialRampToValueAtTime(maxRpm * k * mul, t0 + 0.95);
      param.setValueAtTime(maxRpm * k * mul, t0 + 1.1);
      param.exponentialRampToValueAtTime(idle * 1.2 * k * mul, t0 + 2.4);
    };
    const parts = [['sawtooth', 1, 0.45], ['square', 0.5, 0.3], ['sawtooth', 2.003, 0.18]];
    parts.forEach(([type, mul, gain]) => {
      const o = ctx.createOscillator();
      o.type = type;
      ramp(o.frequency, mul);
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(shaper);
      o.start(t0);
      o.stop(t0 + 2.8);
    });

    // cross-plane V8 burble
    if (cyl === 8 || profile.diesel) {
      const lfo = ctx.createOscillator();
      ramp(lfo.frequency, 0.25);
      const depth = ctx.createGain();
      depth.gain.value = 0.35;
      lfo.connect(depth).connect(body.gain);
      lfo.start(t0);
      lfo.stop(t0 + 2.8);
    }

    const n = this.noise(3);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(800, t0);
    bp.frequency.exponentialRampToValueAtTime(3000, t0 + 0.95);
    const ng = ctx.createGain();
    ng.gain.value = profile.diesel ? 0.12 : 0.06;
    n.connect(bp).connect(ng).connect(out);
    n.start(t0);
    n.stop(t0 + 2.8);
  }

  blip(freq = 880, dur = 0.05, vol = 0.08) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  whoosh() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const n = this.noise(1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(4000, ctx.currentTime + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.85);
    n.connect(bp).connect(g).connect(this.master);
    n.start();
    n.stop(ctx.currentTime + 0.9);
  }
}
