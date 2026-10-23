import type { WeaponId } from "../../shared/weapons";
import type { MapId } from "../../shared/map/types";
import { assetUrl } from "../assets/url";

type V3 = { x: number; y: number; z: number };

/** What the ambient bed plays: a map's soundscape, the menu drone, or nothing. */
type BedKey = MapId | "lobby";
type Timer = ReturnType<typeof setTimeout>;

/** One ambient bed: looping sources into one fader, plus timers for its occasional events. */
interface Bed { key: BedKey; out: GainNode; sources: AudioScheduledSourceNode[]; timers: Set<Timer> }

/** The menu bed sits under the match beds, which already sit far under gunfire. */
const LOBBY_LEVEL = 0.7;
/** The menu theme (a mastered track, so far louder than the synth beds) and its level in the bed. */
const LOBBY_THEME = "/audio/lobby-theme.mp3";
const LOBBY_THEME_LEVEL = 0.55;
/** Seconds of the theme's intro that are skipped, on the first play and on every loop. */
const LOBBY_THEME_SKIP = 10;
/**
 * How long the menu bed outlives the menu screen that asked for it: going from the home lobby to a
 * room's waiting room swaps screens, and the next one picks the theme up without a restart.
 */
const LOBBY_HANDOFF_MS = 400;
/** Events that unlock audio in browsers (touch only counts on release). */
const GESTURES = ["pointerdown", "pointerup", "keydown", "touchend"] as const;

interface ShotVoice {
  crack: number; // high-frequency snap level
  body: number; // mid noise level
  thump: number; // low sine thump level
  pitch: number; // filter frequency multiplier
  length: number; // seconds of the body burst
  tail: number; // reverb send
}

/** Sounds nearer than this (m) use HRTF; farther ones use the far cheaper equal-power panning. */
const HRTF_RANGE = 20;
const MAX_HRTF = 8;
/** Spatial sounds alive at once; past this only loud (near) ones still start. */
const MAX_SPATIAL = 40;
const LOUD_ENOUGH = 0.3;

/** One playing sound: its routing is cut when it ends so the audio thread stops processing it. */
interface Voice { end: number; nodes: AudioNode[]; spatial: boolean; hrtf: boolean }

const SHOTS: Record<WeaponId, ShotVoice> = {
  ar: { crack: 0.9, body: 1, thump: 0.9, pitch: 1, length: 0.16, tail: 0.55 },
  smg: { crack: 0.8, body: 0.8, thump: 0.6, pitch: 1.3, length: 0.11, tail: 0.4 },
  shotgun: { crack: 0.7, body: 1.3, thump: 1.3, pitch: 0.7, length: 0.3, tail: 0.8 },
  sniper: { crack: 1.2, body: 1.2, thump: 1.4, pitch: 0.85, length: 0.35, tail: 1 },
  pistol: { crack: 0.9, body: 0.7, thump: 0.55, pitch: 1.2, length: 0.12, tail: 0.45 },
};

/**
 * Procedural sound engine: layered gunshots with an outdoor echo, spatial panning with distance
 * filtering, footsteps, UI sounds and a per-map ambient bed. The one audio file is the menu theme.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private reverbGain!: GainNode;
  private noise!: AudioBuffer;
  /** Which bed should play: set by `lobby()` and `setMap()`, started once audio is unlocked. */
  private mode: "off" | "lobby" | "match" = "off";
  private map: MapId = "village";
  private bed: Bed | null = null;
  private disarm: (() => void) | null = null;
  private lobbyOff: Timer | null = null;
  private listener = { x: 0, y: 0, z: 0 };
  private forward = { x: 0, y: 0, z: -1 };
  private listenerSynced = false;
  private voices: Voice[] = [];
  /** The menu theme: its bytes fetched as soon as the lobby wants it, decoded once audio is unlocked. */
  private themeBytes: Promise<ArrayBuffer> | null = null;
  private theme: Promise<AudioBuffer> | null = null;
  volume = 0.8;

  /**
   * Creates or resumes the audio context. From a user gesture (click/tap) this always unlocks
   * audio; without one the context only runs where the browser allows autoplay, and otherwise
   * waits, suspended, for the next gesture.
   */
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
    ctx.onstatechange = () => { if (ctx.state === "running") this.disarm?.(); };
    this.applyBed();
  }

  setVolume(v: number) {
    if (v === this.volume) return;
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /**
   * Ends a match's sound: its ambience fades out and every playing sound is cut. The context is
   * kept, so the lobby bed and UI sounds work straight away without another gesture; a lobby bed
   * that is already playing keeps going.
   */
  dispose() {
    if (this.mode === "match") this.mode = "off";
    this.applyBed();
    for (const v of this.voices) for (const n of v.nodes) n.disconnect();
    this.voices = [];
    this.listenerSynced = false;
  }

  /** Crossfades to `id`'s ambience (the match bed replaces the lobby bed). */
  setMap(id: MapId) {
    this.map = id;
    this.mode = "match";
    this.armUnlock();
    this.applyBed();
  }

  /**
   * Starts or stops the menu bed. It plays at once where the browser allows autoplay (Chrome does
   * for sites you often play sound on), otherwise from the first click or key press.
   */
  lobby(on: boolean) {
    if (this.lobbyOff) clearTimeout(this.lobbyOff);
    this.lobbyOff = null;
    if (on) {
      this.mode = "lobby";
      void this.fetchTheme();
      this.armUnlock();
      if (typeof window !== "undefined") this.unlock();
    } else if (this.mode === "lobby") {
      // Another menu screen may take over straight away; stop only if none does.
      this.lobbyOff = setTimeout(() => {
        this.lobbyOff = null;
        if (this.mode !== "lobby") return;
        this.mode = "off";
        this.disarm?.();
        this.applyBed();
      }, LOBBY_HANDOFF_MS);
      return;
    }
    this.applyBed();
  }

  /** Unlocks audio on the next pointer or key press, until the context is running. */
  private armUnlock() {
    if (this.disarm || typeof document === "undefined" || this.ctx?.state === "running") return;
    const gesture = () => {
      this.unlock();
      if (this.ctx?.state === "running") this.disarm?.();
    };
    for (const e of GESTURES) document.addEventListener(e, gesture, true);
    this.disarm = () => {
      for (const e of GESTURES) document.removeEventListener(e, gesture, true);
      this.disarm = null;
    };
  }

  /**
   * Disconnects finished sounds. Left connected, every past gunshot's panner and filters keep
   * running until garbage collection; in a 16-player firefight that piles up until the audio
   * thread misses its deadline and the whole mix drops out.
   */
  private sweep() {
    const now = this.ctx?.currentTime ?? Infinity;
    let kept = 0;
    for (const v of this.voices) {
      if (v.end > now) { this.voices[kept++] = v; continue; }
      for (const n of v.nodes) n.disconnect();
    }
    this.voices.length = kept;
  }

  setListener(pos: V3, forward: V3) {
    if (this.voices.length) this.sweep();
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

  /**
   * Input for a sound at `pos` (non-spatial when omitted) lasting `seconds` from `delay`, or null
   * when many sounds already play and this one would be faint. Returns the input node, the
   * distance and the voice, to which reverb sends are added so they are cut with it.
   */
  private spatial(pos: V3 | undefined, seconds: number, delay = 0): [AudioNode, number, Voice] | null {
    const ctx = this.ctx!;
    const bus = ctx.createGain();
    const voice: Voice = { end: ctx.currentTime + delay + seconds + 0.1, nodes: [bus], spatial: !!pos, hrtf: false };
    if (!pos) {
      bus.connect(this.sfx);
      this.voices.push(voice);
      return [bus, 0, voice];
    }
    const dist = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
    let spatial = 0, hrtf = 0;
    for (const v of this.voices) { if (v.spatial) spatial++; if (v.hrtf) hrtf++; }
    // Same curve as the panner below: a crowded mix skips only sounds too far away to matter.
    const loudness = 3 / (3 + 1.1 * Math.max(0, dist - 3));
    if (spatial >= MAX_SPATIAL && loudness < LOUD_ENOUGH) return null;
    const panner = ctx.createPanner();
    voice.hrtf = dist < HRTF_RANGE && hrtf < MAX_HRTF;
    panner.panningModel = voice.hrtf ? "HRTF" : "equalpower";
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
    bus.connect(lp).connect(panner).connect(this.sfx);
    voice.nodes.push(lp, panner);
    this.voices.push(voice);
    return [bus, dist, voice];
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

  /**
   * A gunshot. Remote shots are told apart by `side`, subtly: an enemy's has a sharper, brighter
   * crack; a teammate's is a little rounder and quieter, so friendly fire nearby reads as safe.
   */
  shot(weapon: WeaponId, pos?: V3, local = false, side: "ally" | "enemy" = "enemy") {
    const ctx = this.ctx;
    if (!ctx) return;
    const v = SHOTS[weapon];
    const t = ctx.currentTime + 0.001;
    const route = this.spatial(pos, Math.max(0.2, v.length) + 0.05);
    if (!route) return;
    const [out, dist, voice] = route;
    const ally = !local && side === "ally";
    const gainMul = local ? 0.9 : ally ? 0.82 : 1;
    const crackMul = local ? 1 : ally ? 0.55 : 1.2;
    const tone = ally ? 0.86 : 1;
    const jitter = 0.94 + Math.random() * 0.12;

    // Crack: very short bright noise.
    const crack = this.noiseSource(t, 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2400 * v.pitch * jitter * (ally ? 0.75 : local ? 1 : 1.15);
    const cg = ctx.createGain();
    this.env(cg, t, 0.9 * v.crack * gainMul * crackMul, 0.001, 0.045);
    crack.connect(hp).connect(cg).connect(out);

    // Body: band-limited noise burst.
    const body = this.noiseSource(t, v.length);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 * v.pitch * jitter * tone;
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
    voice.nodes.push(send);
  }

  dryFire() {
    this.click(3200, 0.25);
  }

  click(freq = 2000, level = 0.3, pos?: V3, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const route = this.spatial(pos, 0.05, delay);
    if (!route) return;
    const [out] = route;
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
    const route = this.spatial(pos, 0.12);
    if (!route) return;
    const [out] = route;
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
    n.connect(f).connect(g).connect(this.spatial(undefined, 0.2)![0]);
  }

  hitmarker(head: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = head ? 2600 : 1700;
    const g = ctx.createGain();
    this.env(g, t, head ? 0.28 : 0.2, 0.001, 0.05);
    o.connect(g).connect(this.spatial(undefined, 0.1)![0]);
    o.start(t);
    o.stop(t + 0.08);
  }

  /** Dry metallic attack and a short resolved interval, reserved for confirmed kills. */
  elimination(head: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.001;
    this.click(3200, 0.12);
    const tone = (frequency: number, delay: number, level: number, decay: number, type: OscillatorType) => {
      const start = t + delay;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      this.env(gain, start, level, 0.005, decay);
      osc.connect(gain).connect(this.spatial(undefined, decay + 0.03, delay)![0]);
      osc.start(start);
      osc.stop(start + decay + 0.015);
    };
    tone(660, 0, 0.19, 0.085, "triangle");
    tone(990, 0.055, 0.16, 0.19, "sine");
    tone(1980, 0.055, 0.035, 0.12, "sine");
    if (head) tone(2640, 0.012, 0.05, 0.1, "sine");
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
    o.connect(g).connect(this.spatial(undefined, 0.3)![0]);
    o.start(t);
    o.stop(t + 0.3);
  }

  explosion(pos: V3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const route = this.spatial(pos, 2.4);
    if (!route) return;
    const [out, dist, voice] = route;
    // Blast: a bright crack that closes down into a long rumble.
    const n = this.noiseSource(t, 2.3);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 1.6);
    const g = ctx.createGain();
    this.env(g, t, 2, 0.003, 2);
    n.connect(lp).connect(g).connect(out);
    // Sub thump, and a second, lower one for weight.
    for (const [from, to, level, decay] of [[75, 24, 1.6, 1.1], [48, 18, 1.2, 1.6]]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.9);
      const og = ctx.createGain();
      this.env(og, t, level, 0.004, decay);
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
    // Debris pattering down after the blast.
    for (let i = 0; i < 5; i++) this.click(600 + Math.random() * 900, 0.12, pos, 0.35 + Math.random() * 0.6);
    const send = ctx.createGain();
    send.gain.value = 1 + Math.min(1, dist / 40);
    g.connect(send).connect(this.reverb);
    voice.nodes.push(send);
  }

  /** A cooked grenade's fuse ticking in hand, quicker and higher in its last second. */
  fuseTick(urgent: boolean) {
    this.click(urgent ? 3600 : 2400, urgent ? 0.22 : 0.14);
  }

  /** The pin coming out: a cooked grenade's fuse is burning. */
  grenadePin() {
    this.click(2600, 0.3);
    this.click(4200, 0.18, undefined, 0.06);
  }

  grenadeThrow() {
    this.click(700, 0.3);
    this.click(3000, 0.15, undefined, 0.05);
  }

  ui() {
    this.click(2200, 0.15);
  }

  /** A soft tick for pointing at a menu control. */
  uiHover() {
    const ctx = this.ctx;
    if (!ctx) return;
    const [bus] = this.eventBus(this.sfx, 0.06);
    this.blip(bus, "triangle", 2100 * (0.97 + Math.random() * 0.06), ctx.currentTime + 0.001, 0.03, 0.002, 0.03);
  }

  /** Confirm: a short upward blip on a click. */
  uiClick() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.001;
    const [bus] = this.eventBus(this.sfx, 0.12);
    this.blip(bus, "sine", 1180, t, 0.07, 0.003, 0.06, 1560);
    this.burst(bus, "bandpass", 2600, 3, t, 0.08, 0.001, 0.025);
  }

  /** Switching tabs: a quick downward slide and a light tick. */
  uiTab() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.001;
    const [bus] = this.eventBus(this.sfx, 0.12);
    this.blip(bus, "triangle", 1500, t, 0.05, 0.002, 0.05, 1050);
    this.blip(bus, "sine", 2400, t + 0.035, 0.025, 0.002, 0.04);
  }

  /** Ready: a soft two-note confirm, a fifth up. */
  uiSting() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const [bus] = this.eventBus(this.sfx, 1, 0, 0.4);
    [[329.63, 0], [493.88, 0.09]].forEach(([f, at]) => {
      this.blip(bus, "triangle", f, t + at, 0.035, 0.006, 0.35);
      this.blip(bus, "sine", f * 2, t + at, 0.008, 0.006, 0.25);
    });
  }

  /**
   * Deploy, as a match starts: a deep impact under a short, dark chord stab (A minor, filtered
   * saws closing down) and a metallic ping that rings out. No noise in it.
   */
  uiDeploy() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const [bus] = this.eventBus(this.sfx, 2.6, 0, 0.9);
    this.blip(bus, "sine", 92, t, 0.16, 0.004, 0.9, 38);
    this.blip(bus, "sine", 46, t, 0.1, 0.01, 1.2, 30);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.9);
    lp.connect(bus);
    for (const f of [110, 164.81, 261.63]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const g = ctx.createGain();
      this.env(g, t, 0.022, 0.01, 0.9);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + 1);
    }
    this.blip(bus, "sine", 1318.5, t + 0.06, 0.012, 0.003, 1.2);
    this.blip(bus, "sine", 1975.5, t + 0.06, 0.005, 0.003, 0.8);
  }

  /** Starts, crossfades or stops the ambient bed to match the mode. Needs an unlocked context. */
  private applyBed() {
    if (!this.ctx) return;
    const want: BedKey | null = this.mode === "lobby" ? "lobby" : this.mode === "match" ? this.map : null;
    if ((this.bed?.key ?? null) === want) return;
    if (this.bed) this.fadeOutBed(this.bed, want ? 1.4 : 0.8);
    this.bed = want ? this.startBed(want) : null;
  }

  private startBed(key: BedKey): Bed {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(key === "lobby" ? LOBBY_LEVEL : 1, t + (key === "lobby" ? 1.5 : 2.5));
    out.connect(this.master);
    const bed: Bed = { key, out, sources: [], timers: new Set() };
    switch (key) {
      case "lobby": this.lobbyBed(bed); break;
      case "downtown": this.downtownBed(bed); break;
      case "industrial": this.freightBed(bed); break;
      case "outpost": this.outpostBed(bed); break;
      default: this.villageBed(bed);
    }
    return bed;
  }

  private fadeOutBed(bed: Bed, seconds: number) {
    const t = this.ctx!.currentTime;
    for (const id of bed.timers) clearTimeout(id);
    bed.timers.clear();
    const g = bed.out.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
    g.linearRampToValueAtTime(0, t + seconds);
    for (const s of bed.sources) s.stop(t + seconds + 0.05);
    setTimeout(() => bed.out.disconnect(), (seconds + 0.2) * 1000);
  }

  // --- Bed building blocks: a few long-lived nodes per bed, events from timers. ---

  /** Looping filtered noise from the shared buffer; `rate` below 1 darkens and decorrelates it. */
  private loopNoise(bed: Bed, type: BiquadFilterType, freq: number, q: number, level: number, rate = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(f).connect(g).connect(bed.out);
    src.start(0, Math.random() * 2);
    bed.sources.push(src);
    return g;
  }

  /** A steady oscillator at `level` into `dest`; returns its gain for modulation. */
  private drone(bed: Bed, type: OscillatorType, freq: number, level: number, dest: AudioNode = bed.out) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g).connect(dest);
    o.start();
    bed.sources.push(o);
    return g;
  }

  /** Adds a slow wobble of ±`depth` to `param` (keep depth below the base value). */
  private lfo(bed: Bed, rate: number, depth: number, param: AudioParam, type: OscillatorType = "sine") {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
    bed.sources.push(o);
  }

  private lowpass(freq: number, q: number, dest: AudioNode) {
    const f = this.ctx!.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  /** Runs `play` every `minMs`–`maxMs` while `bed` is the current bed. */
  private every(bed: Bed, minMs: number, maxMs: number, play: () => void, firstMs = minMs) {
    const schedule = (ms: number) => {
      const id = setTimeout(() => {
        bed.timers.delete(id);
        if (this.bed !== bed || !this.ctx) return;
        play();
        schedule(minMs + Math.random() * (maxMs - minMs));
      }, ms);
      bed.timers.add(id);
    };
    schedule(firstMs);
  }

  /** Input for a short non-spatial sound, panned and optionally sent to the echo; cut once done. */
  private eventBus(out: AudioNode, seconds: number, pan = 0, reverb = 0): [GainNode, StereoPannerNode] {
    const ctx = this.ctx!;
    if (this.voices.length > 16) this.sweep();
    const bus = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    bus.connect(panner).connect(out);
    const nodes: AudioNode[] = [bus, panner];
    if (reverb) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      bus.connect(send).connect(this.reverb);
      nodes.push(send);
    }
    this.voices.push({ end: ctx.currentTime + seconds + 0.1, nodes, spatial: false, hrtf: false });
    return [bus, panner];
  }

  /** One enveloped tone, optionally gliding to `glideTo`. */
  private blip(dest: AudioNode, type: OscillatorType, freq: number, t: number, peak: number, attack: number, decay: number, glideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, peak, attack, decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.02);
  }

  /** A looped noise source from `t` for `seconds` (safe for sounds longer than the buffer). */
  private noiseLoop(t: number, seconds: number, rate = 1) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(t, Math.random() * 2);
    src.stop(t + seconds + 0.05);
    return src;
  }

  /** One enveloped, filtered noise hit. */
  private burst(dest: AudioNode, type: BiquadFilterType, freq: number, q: number, t: number, peak: number, attack: number, decay: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, attack, decay);
    this.noiseLoop(t, attack + decay).connect(f).connect(g).connect(dest);
  }

  /** Linear swell from silence to `peak` at `t + rise` and back to silence at `t + length`. */
  private swell(g: GainNode, t: number, peak: number, rise: number, length: number) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + rise);
    g.gain.linearRampToValueAtTime(0, t + length);
  }

  private side(spread: number) {
    return (Math.random() * 2 - 1) * spread;
  }

  // --- Beds ---

  /** Village: wind through the trees and birdsong. */
  private villageBed(b: Bed) {
    const wind = this.loopNoise(b, "lowpass", 420, 1, 0.05);
    this.lfo(b, 0.07, 0.03, wind.gain);
    this.every(b, 2500, 9500, () => this.birdCall(b), 2000);
  }

  private birdCall(b: Bed) {
    const t = this.ctx!.currentTime;
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2400 + Math.random() * 1800;
    const [bus] = this.eventBus(b.out, n * 0.15 + 0.1, this.side(1));
    for (let i = 0; i < n; i++) {
      const st = t + i * (0.09 + Math.random() * 0.05);
      const up = base * (1.2 + Math.random() * 0.4);
      this.blip(bus, "sine", base, st, 0.018, 0.005, 0.06, up);
    }
  }

  /**
   * Downtown: a soft, low traffic rumble, a city hum, passing cars, far horns and sirens. Kept
   * low-pitched and quiet: any mid-range noise in the bed reads as hiss.
   */
  private downtownBed(b: Bed) {
    const rumble = this.loopNoise(b, "lowpass", 110, 0.7, 0.024, 0.5);
    this.lfo(b, 0.05, 0.009, rumble.gain);
    this.drone(b, "sine", 118, 0.002);
    this.every(b, 5000, 14000, () => {
      const r = Math.random();
      if (r < 0.55) this.carPass(b); else if (r < 0.85) this.carHorn(b); else this.siren(b);
    }, 3000);
  }

  private carPass(b: Bed) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.05;
    const len = 3 + Math.random() * 2;
    const from = Math.random() < 0.5 ? -0.8 : 0.8;
    const [bus, pan] = this.eventBus(b.out, len, from);
    pan.pan.setValueAtTime(from, t);
    pan.pan.linearRampToValueAtTime(-from, t + len);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(200, t);
    f.frequency.linearRampToValueAtTime(380, t + len * 0.5);
    f.frequency.linearRampToValueAtTime(200, t + len);
    const g = ctx.createGain();
    this.swell(g, t, 0.014 + Math.random() * 0.008, len * 0.5, len);
    this.noiseLoop(t, len, 0.7).connect(f).connect(g).connect(bus);
  }

  private carHorn(b: Bed) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.05;
    const [bus] = this.eventBus(b.out, 1.2, this.side(0.8), 0.6);
    const lp = this.lowpass(1100, 0.7, bus);
    const pitch = 0.9 + Math.random() * 0.2;
    const honks = Math.random() < 0.5 ? [[0, 0.16], [0.24, 0.4]] : [[0, 0.5]];
    for (const [at, dur] of honks) {
      const s = t + at;
      for (const freq of [405, 510]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = freq * pitch;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.004, s + 0.02);
        g.gain.setValueAtTime(0.004, s + dur);
        g.gain.linearRampToValueAtTime(0, s + dur + 0.05);
        o.connect(g).connect(lp);
        o.start(s);
        o.stop(s + dur + 0.08);
      }
    }
  }

  private siren(b: Bed) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.05;
    const len = 9;
    const [bus] = this.eventBus(b.out, len, this.side(0.7), 0.7);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 760;
    const wail = ctx.createOscillator();
    wail.frequency.value = 0.2;
    const depth = ctx.createGain();
    depth.gain.value = 170;
    wail.connect(depth).connect(o.frequency);
    const g = ctx.createGain();
    this.swell(g, t, 0.006, len * 0.45, len);
    o.connect(g).connect(this.lowpass(1500, 0.7, bus));
    for (const n of [o, wail]) { n.start(t); n.stop(t + len); }
  }

  /** Freight yard: machinery hum, light wind, metal clanks, container bangs, a far train horn. */
  private freightBed(b: Bed) {
    this.loopNoise(b, "lowpass", 110, 0.7, 0.075, 0.5);
    const hum = this.lowpass(180, 0.7, b.out);
    this.drone(b, "sawtooth", 50, 0.007, hum);
    this.drone(b, "sine", 100, 0.0025);
    const wind = this.loopNoise(b, "lowpass", 520, 1, 0.03);
    this.lfo(b, 0.06, 0.018, wind.gain);
    this.every(b, 3500, 10000, () => { if (Math.random() < 0.7) this.clank(b); else this.containerBang(b); }, 2500);
    this.every(b, 35000, 90000, () => this.trainHorn(b), 15000 + Math.random() * 20000);
  }

  private clank(b: Bed) {
    const t = this.ctx!.currentTime + 0.02;
    const [bus] = this.eventBus(b.out, 1.6, this.side(0.8), 0.8);
    const hits = Math.random() < 0.4 ? 2 + Math.floor(Math.random() * 2) : 1;
    const base = 280 + Math.random() * 420;
    let s = t;
    for (let i = 0; i < hits; i++) {
      const level = i ? 0.5 : 1;
      for (const [ratio, peak, decay] of [[1, 0.012, 0.7], [2.76, 0.007, 0.45], [5.4, 0.004, 0.25]]) {
        this.blip(bus, "sine", base * ratio, s, peak * level, 0.002, decay);
      }
      this.burst(bus, "bandpass", 3200, 1.5, s, 0.03 * level, 0.001, 0.02);
      s += 0.1 + Math.random() * 0.15;
    }
  }

  private containerBang(b: Bed) {
    const t = this.ctx!.currentTime + 0.02;
    const [bus] = this.eventBus(b.out, 2, this.side(0.8), 1.2);
    this.burst(bus, "lowpass", 260, 0.7, t, 0.15, 0.004, 0.9);
    this.blip(bus, "sine", 70, t, 0.035, 0.003, 0.6, 36);
    this.blip(bus, "sine", 183, t, 0.004, 0.003, 1.4);
    this.blip(bus, "sine", 417, t, 0.0025, 0.003, 1);
  }

  private trainHorn(b: Bed) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.05;
    const blasts = Math.random() < 0.5 ? [[0, 2.2]] : [[0, 1.6], [2, 0.7]];
    const [bus] = this.eventBus(b.out, 4, this.side(0.5), 0.9);
    const lp = this.lowpass(900, 0.7, bus);
    for (const [at, dur] of blasts) {
      const s = t + at;
      for (const freq of [311, 370, 466]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = freq * (1 + Math.random() * 0.004);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.003, s + 0.35);
        g.gain.setValueAtTime(0.003, s + dur);
        g.gain.linearRampToValueAtTime(0, s + dur + 0.8);
        o.connect(g).connect(lp);
        o.start(s);
        o.stop(s + dur + 0.85);
      }
    }
  }

  /**
   * Outpost: a soft, low desert wind, a far generator, radio squelch, helicopter passes. No sand
   * hiss, and the wind stays below the range that reads as noise.
   */
  private outpostBed(b: Bed) {
    const wind = this.loopNoise(b, "lowpass", 340, 0.7, 0.016, 0.9);
    this.lfo(b, 0.09, 0.008, wind.gain);
    const generator = this.drone(b, "sawtooth", 55, 0.0045, this.lowpass(200, 0.7, b.out));
    this.lfo(b, 6.5, 0.0018, generator.gain);
    this.every(b, 14000, 32000, () => this.radio(b), 7000);
    this.every(b, 50000, 110000, () => this.helicopter(b), 25000 + Math.random() * 20000);
  }

  private radio(b: Bed) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    const len = 0.15 + Math.random() * 0.3;
    const [bus] = this.eventBus(b.out, len + 0.2, this.side(0.7), 0.3);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1900;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012, t + 0.004);
    g.gain.setValueAtTime(0.012, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + 0.02);
    this.noiseLoop(t, len + 0.03).connect(f).connect(g).connect(bus);
    this.blip(bus, "sine", 1350, t + len + 0.05, 0.005, 0.003, 0.07);
  }

  private helicopter(b: Bed) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.05;
    const len = 10 + Math.random() * 4;
    const from = Math.random() < 0.5 ? -0.9 : 0.9;
    const [bus, pan] = this.eventBus(b.out, len, from, 0.4);
    pan.pan.setValueAtTime(from, t);
    pan.pan.linearRampToValueAtTime(-from, t + len);
    // Blade slap: noise chopped by a square wave a little slower as it goes (Doppler).
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const rotor = ctx.createOscillator();
    rotor.type = "square";
    rotor.frequency.setValueAtTime(12.5, t);
    rotor.frequency.linearRampToValueAtTime(11, t + len);
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    rotor.connect(depth).connect(chop.gain);
    rotor.start(t);
    rotor.stop(t + len);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.linearRampToValueAtTime(650, t + len * 0.5);
    lp.frequency.linearRampToValueAtTime(280, t + len);
    const g = ctx.createGain();
    this.swell(g, t, 0.04, len * 0.5, len);
    this.noiseLoop(t, len, 0.5).connect(chop).connect(lp).connect(g).connect(bus);
  }

  /** Downloads the menu theme once; a failed download is tried again next time. */
  private fetchTheme(): Promise<ArrayBuffer> {
    if (!this.themeBytes) {
      const bytes = fetch(assetUrl(LOBBY_THEME)).then((r) => {
        if (!r.ok) throw new Error(`lobby theme: HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      bytes.catch(() => { if (this.themeBytes === bytes) this.themeBytes = null; });
      this.themeBytes = bytes;
    }
    return this.themeBytes;
  }

  /** Lobby: the menu theme, looped and faded in once it has loaded (the synth bed if it can't). */
  private lobbyBed(b: Bed) {
    const ctx = this.ctx!;
    this.theme ??= this.fetchTheme().then((bytes) => ctx.decodeAudioData(bytes));
    this.theme.then((buffer) => {
      if (this.bed !== b) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.loopStart = Math.min(LOBBY_THEME_SKIP, buffer.duration / 2);
      src.loopEnd = buffer.duration;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(LOBBY_THEME_LEVEL, t + 1.2);
      src.connect(g).connect(b.out);
      src.start(t, src.loopStart);
      b.sources.push(src);
    }, () => {
      // Decoding consumed the bytes, so start over next time.
      this.theme = null;
      this.themeBytes = null;
      if (this.bed === b) this.lobbySynth(b);
    });
  }

  /** The fallback menu bed: a low detuned drone under a soft minor pad, a slow pulse and distant pings. */
  private lobbySynth(b: Bed) {
    const lp = this.lowpass(300, 3, b.out);
    this.lfo(b, 0.035, 140, lp.frequency);
    this.drone(b, "sawtooth", 55, 0.008, lp);
    this.drone(b, "sawtooth", 55.35, 0.008, lp);
    this.drone(b, "triangle", 82.41, 0.006, lp);
    const pad = this.ctx!.createGain();
    pad.connect(b.out);
    this.lfo(b, 0.06, 0.45, pad.gain);
    for (const f of [220, 261.63, 329.63]) this.drone(b, "triangle", f, 0.0035, pad);
    const pulse = this.drone(b, "sawtooth", 110, 0.006, this.lowpass(220, 1, b.out));
    this.lfo(b, 0.5, 0.006, pulse.gain);
    this.every(b, 7000, 14000, () => {
      const t = this.ctx!.currentTime + 0.02;
      const [bus] = this.eventBus(b.out, 2.6, this.side(0.5), 1);
      const note = [659.25, 880, 1318.5, 1760][Math.floor(Math.random() * 4)];
      this.blip(bus, "sine", note, t, 0.006, 0.01, 2.5);
      this.blip(bus, "sine", note * 2, t, 0.002, 0.01, 1.6);
    }, 4000);
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
