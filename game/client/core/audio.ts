import type { WeaponId } from "../../shared/weapons";

type V3 = { x: number; y: number; z: number };

interface ShotVoice {
  crack: number; // high-frequency snap level
  body: number; // mid noise level
  thump: number; // low sine thump level
  pitch: number; // filter frequency multiplier
  length: number; // seconds of the body burst
  tail: number; // reverb send
}

const SHOTS: Record<WeaponId, ShotVoice> = {
  ar: { crack: 0.9, body: 1, thump: 0.9, pitch: 1, length: 0.16, tail: 0.55 },
  smg: { crack: 0.8, body: 0.8, thump: 0.6, pitch: 1.3, length: 0.11, tail: 0.4 },
  shotgun: { crack: 0.7, body: 1.3, thump: 1.3, pitch: 0.7, length: 0.3, tail: 0.8 },
  sniper: { crack: 1.2, body: 1.2, thump: 1.4, pitch: 0.85, length: 0.35, tail: 1 },
  pistol: { crack: 0.9, body: 0.7, thump: 0.55, pitch: 1.2, length: 0.12, tail: 0.45 },
};

/**
 * Procedural sound engine (no audio files): layered gunshots with an outdoor echo, spatial
 * panning with distance filtering, footsteps, UI ticks and an ambient wind/bird bed.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private reverbGain!: GainNode;
  private noise!: AudioBuffer;
  private ambience: { stop: () => void } | null = null;
  private listener = { x: 0, y: 0, z: 0 };
  private forward = { x: 0, y: 0, z: -1 };
  private listenerSynced = false;
  volume = 0.8;

  /** Must be called from a user gesture (click/tap) to unlock audio. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.listenerSynced = false;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  setVolume(v: number) {
    if (v === this.volume) return;
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  dispose() {
    this.ambience?.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.listenerSynced = false;
  }

  setListener(pos: V3, forward: V3) {
    const moved = !this.listenerSynced || pos.x !== this.listener.x || pos.y !== this.listener.y || pos.z !== this.listener.z;
    const turned = !this.listenerSynced || forward.x !== this.forward.x || forward.y !== this.forward.y || forward.z !== this.forward.z;
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    this.forward.x = forward.x; this.forward.y = forward.y; this.forward.z = forward.z;
    const l = this.ctx?.listener;
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      if (moved) {
        l.positionX.setValueAtTime(pos.x, t);
        l.positionY.setValueAtTime(pos.y, t);
        l.positionZ.setValueAtTime(pos.z, t);
      }
      if (turned) {
        l.forwardX.setValueAtTime(forward.x, t);
        l.forwardY.setValueAtTime(forward.y, t);
        l.forwardZ.setValueAtTime(forward.z, t);
      }
      if (!this.listenerSynced) {
        l.upX.setValueAtTime(0, t);
        l.upY.setValueAtTime(1, t);
        l.upZ.setValueAtTime(0, t);
      }
    } else {
      if (moved) l.setPosition(pos.x, pos.y, pos.z);
      if (turned) l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
    this.listenerSynced = true;
  }

  /** Output chain for a sound at `pos` (or non-spatial when omitted). Returns [input, distance]. */
  private spatial(pos?: V3): [AudioNode, number] {
    const ctx = this.ctx!;
    if (!pos) return [this.sfx, 0];
    const dist = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 3;
    panner.rolloffFactor = 1.1;
    panner.maxDistance = 400;
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else panner.setPosition(pos.x, pos.y, pos.z);
    // Air absorbs highs over distance.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(900, 18000 / (1 + dist * 0.06));
    lp.connect(panner).connect(this.sfx);
    return [lp, dist];
  }

  private noiseSource(start: number, dur: number) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.start(start, Math.random() * 1.5, dur + 0.05);
    return src;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  shot(weapon: WeaponId, pos?: V3, local = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const v = SHOTS[weapon];
    const t = ctx.currentTime + 0.001;
    const [out, dist] = this.spatial(pos);
    const gainMul = local ? 0.9 : 1;
    const jitter = 0.94 + Math.random() * 0.12;

    // Crack: very short bright noise.
    const crack = this.noiseSource(t, 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2400 * v.pitch * jitter;
    const cg = ctx.createGain();
    this.env(cg, t, 0.9 * v.crack * gainMul, 0.001, 0.045);
    crack.connect(hp).connect(cg).connect(out);

    // Body: band-limited noise burst.
    const body = this.noiseSource(t, v.length);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 * v.pitch * jitter;
    bp.Q.value = 0.7;
    const bg = ctx.createGain();
    this.env(bg, t, 1.1 * v.body * gainMul, 0.002, v.length);
    body.connect(bp).connect(bg).connect(out);

    // Thump: pitched-down sine for weight.
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140 * v.pitch, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const og = ctx.createGain();
    this.env(og, t, 0.9 * v.thump * gainMul, 0.002, 0.14);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);

    // Echo off the village walls.
    const send = ctx.createGain();
    send.gain.value = v.tail * (0.5 + Math.min(1, dist / 60));
    bg.connect(send).connect(this.reverb);
  }

  dryFire() {
    this.click(3200, 0.25);
  }

  click(freq = 2000, level = 0.3, pos?: V3, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const [out] = this.spatial(pos);
    const n = this.noiseSource(t, 0.03);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 4;
    const g = ctx.createGain();
    this.env(g, t, level, 0.001, 0.03);
    n.connect(bp).connect(g).connect(out);
  }

  reload(durationS: number, pos?: V3) {
    // Mag out, mag in, charging handle.
    this.click(1500, 0.35, pos, durationS * 0.2);
    this.click(900, 0.4, pos, durationS * 0.55);
    this.click(2600, 0.3, pos, durationS * 0.85);
    this.click(1800, 0.35, pos, durationS * 0.92);
  }

  switchWeapon() {
    this.click(1200, 0.25);
    this.click(2400, 0.2, undefined, 0.08);
  }

  footstep(stone: boolean, pos?: V3, level = 0.18) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const [out] = this.spatial(pos);
    const n = this.noiseSource(t, 0.08);
    const f = ctx.createBiquadFilter();
    f.type = stone ? "bandpass" : "lowpass";
    f.frequency.value = stone ? 1400 + Math.random() * 500 : 700 + Math.random() * 300;
    f.Q.value = stone ? 1.2 : 0.7;
    const g = ctx.createGain();
    this.env(g, t, level, 0.003, stone ? 0.06 : 0.09);
    n.connect(f).connect(g).connect(out);
  }

  land(level: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noiseSource(t, 0.15);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 500;
    const g = ctx.createGain();
    this.env(g, t, 0.25 * level, 0.003, 0.12);
    n.connect(f).connect(g).connect(this.sfx);
  }

  hitmarker(head: boolean, kill: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = head ? 2600 : 1700;
    const g = ctx.createGain();
    this.env(g, t, head ? 0.28 : 0.2, 0.001, 0.05);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.08);
    if (kill) {
      const o2 = ctx.createOscillator();
      o2.type = "sine";
      o2.frequency.setValueAtTime(880, t + 0.06);
      o2.frequency.exponentialRampToValueAtTime(1320, t + 0.16);
      const g2 = ctx.createGain();
      this.env(g2, t + 0.06, 0.22, 0.005, 0.25);
      o2.connect(g2).connect(this.sfx);
      o2.start(t + 0.06);
      o2.stop(t + 0.4);
    }
  }

  hurt() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.2);
    const g = ctx.createGain();
    this.env(g, t, 0.5, 0.003, 0.22);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.3);
  }

  explosion(pos: V3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const [out, dist] = this.spatial(pos);
    const n = this.noiseSource(t, 1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 1.2);
    const g = ctx.createGain();
    this.env(g, t, 1.6, 0.004, 1.4);
    n.connect(lp).connect(g).connect(out);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    const og = ctx.createGain();
    this.env(og, t, 1.4, 0.004, 0.9);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 1);
    const send = ctx.createGain();
    send.gain.value = 0.9 + Math.min(1, dist / 40);
    g.connect(send).connect(this.reverb);
  }

  grenadeThrow() {
    this.click(700, 0.3);
    this.click(3000, 0.15, undefined, 0.05);
  }

  ui() {
    this.click(2200, 0.15);
  }

  private startAmbience() {
    const ctx = this.ctx!;
    // Wind: slowly modulated low-passed noise.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    lfo.start();
    // Birds: occasional chirps.
    let timer = 0;
    const chirp = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      const n = 2 + Math.floor(Math.random() * 4);
      const base = 2400 + Math.random() * 1800;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 2 - 1;
      pan.connect(this.master);
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator();
        o.type = "sine";
        const st = t + i * (0.09 + Math.random() * 0.05);
        o.frequency.setValueAtTime(base, st);
        o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), st + 0.05);
        const og = ctx.createGain();
        this.env(og, st, 0.018, 0.005, 0.06);
        o.connect(og).connect(pan);
        o.start(st);
        o.stop(st + 0.1);
      }
      timer = window.setTimeout(chirp, 2500 + Math.random() * 7000);
    };
    timer = window.setTimeout(chirp, 2000);
    this.ambience = {
      stop: () => {
        clearTimeout(timer);
        try { src.stop(); lfo.stop(); } catch { /* already stopped */ }
      },
    };
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        // Sparse early reflections, then a smooth tail.
        const t = i / len;
        const early = i < ctx.sampleRate * 0.12 && Math.random() < 0.004 ? 1.5 : 0;
        d[i] = ((Math.random() * 2 - 1) * 0.6 + early * (Math.random() * 2 - 1)) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }
}

export const audio = new AudioEngine();
