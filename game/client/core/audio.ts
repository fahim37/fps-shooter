import { WEAPONS, roundSeats, type WeaponId } from "../../shared/weapons";
import type { MapId } from "../../shared/map/types";
import { assetUrl } from "../assets/url";
import { SHOTGUN_RELOAD_CUES, cycleStrokes } from "../player/handling";

type V3 = { x: number; y: number; z: number };

/** What the ambient bed plays: a map's soundscape, the menu drone, or nothing. */
type BedKey = MapId | "lobby";
type Timer = ReturnType<typeof setTimeout>;

/**
 * Far gunfire and blasts are turned down on top of the distance rolloff: full level up to
 * FAR_FROM metres, easing to FAR_LEVEL by FAR_TO. It covers the echo too, which has no rolloff.
 */
const FAR_FROM = 20, FAR_TO = 70, FAR_LEVEL = 0.5;
/** A map's ambient bed in the mix, and the trim on every footstep (own and other players'). */
const MAP_BED_LEVEL = 1;
const FOOTSTEP_LEVEL = 0.7;

/** One ambient bed: looping sources into one fader, plus timers for its occasional events. */
interface Bed { key: BedKey; out: GainNode; sources: AudioScheduledSourceNode[]; timers: Set<Timer> }

/** The menu bed sits under the match beds, which already sit far under gunfire. */
const LOBBY_LEVEL = 0.7;
/** The menu theme (a mastered track, so far louder than the synth beds) and its level in the bed. */
const LOBBY_THEME = "/audio/lobby-theme.mp3";
const LOBBY_THEME_LEVEL = 0.55;
/** Seconds of the theme's intro that are skipped, on the first play and on every loop. */
const LOBBY_THEME_SKIP = 25;
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
  boom?: number; // level of a low blast rolling off under the shot
}

/** Seconds a shot's boom takes to roll off. */
const BOOM_SECONDS = 0.65;
/** A bullet passing within this far (m) of the listener is heard going by. */
export const WHIZ_RANGE = 2.8;
/** A blast within this far (m) dulls the hearing for a moment. */
const DEAFEN_RANGE = 9;

/** One metal part meeting another: its ring (Hz), level and the thud through the gun (Hz). */
type Clack = [freq: number, level: number, thud: number];
/** How a gun's action sounds opening and closing. */
const ACTIONS: Partial<Record<WeaponId, [open: Clack, close: Clack]>> = {
  shotgun: [[1150, 0.34, 170], [1750, 0.5, 230]],
  sniper: [[2100, 0.22, 300], [2900, 0.3, 360]],
  // The two clicks of a single-action hammer coming to full cock.
  pistol: [[2400, 0.3, 320], [3200, 0.38, 420]],
};
/** A shell thumbed into the shotgun's loading port. */
const SHELL_IN: Clack = [1900, 0.26, 210];

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
  shotgun: { crack: 0.85, body: 1.2, thump: 1.3, pitch: 0.7, length: 0.24, tail: 0.9, boom: 0.8 },
  // An anti-materiel round: the heaviest crack, and a blast rolling off long after it.
  sniper: { crack: 1.3, body: 1.3, thump: 1.6, pitch: 0.75, length: 0.38, tail: 1.2, boom: 1 },
  pistol: { crack: 1, body: 1.15, thump: 1.2, pitch: 0.8, length: 0.2, tail: 0.85, boom: 0.45 },
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
  /** The local gun's pump, bolt or shell-loading sounds still to play. */
  private working: Voice | null = null;
  /** Your own slide scraping along the ground, until it ends. */
  private sliding: { voice: Voice; gain: GainNode } | null = null;
  /** Everything but the menu bed passes through this: it closes for a moment after a blast close by. */
  private ears: BiquadFilterNode | null = null;
  /** When the last bullet was heard going by, so a burst doesn't stack them (s). */
  private whizAt = -1;
  /** The menu theme: its bytes fetched as soon as the lobby wants it, decoded once audio is unlocked. */
  private themeBytes: Promise<ArrayBuffer> | null = null;
  private theme: Promise<AudioBuffer> | null = null;
  volume = 0.8;
  /** Scales only the menu bed (the lobby theme), so players can quiet the music but keep UI sounds. */
  musicVolume = 0.5;

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
    // Gunfire is far louder than everything else: the compressor lets a shot through and pulls the
    // mix back up quickly after it, and the clipper rounds off what still overshoots instead of
    // letting the output clip hard.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.14;
    const clip = ctx.createWaveShaper();
    clip.curve = softClip();
    clip.oversample = "2x";
    this.master.connect(comp).connect(clip).connect(ctx.destination);
    this.ears = ctx.createBiquadFilter();
    this.ears.type = "lowpass";
    this.ears.frequency.value = 20000;
    this.ears.Q.value = 0.5;
    this.ears.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.ears);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.ears);
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

  setMusicVolume(v: number) {
    if (v === this.musicVolume) return;
    this.musicVolume = v;
    // Only the live lobby bed follows; one that is fading out keeps fading.
    if (this.ctx && this.bed?.key === "lobby") {
      const gain = this.bed.out.gain, t = this.ctx.currentTime;
      gain.cancelScheduledValues(t);
      gain.setTargetAtTime(LOBBY_LEVEL * v, t, 0.05);
    }
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
    this.sliding = null;
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
  private spatial(pos: V3 | undefined, seconds: number, delay = 0): [GainNode, number, Voice] | null {
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

  /** How much of a shot or blast `dist` metres away is kept. */
  private farTrim(dist: number) {
    const k = Math.max(0, Math.min(1, (dist - FAR_FROM) / (FAR_TO - FAR_FROM)));
    return 1 - k * (1 - FAR_LEVEL);
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
    const route = this.spatial(pos, Math.max(0.2, v.length, v.boom ? BOOM_SECONDS : 0) + 0.05);
    if (!route) return;
    const [out, dist, voice] = route;
    const far = this.farTrim(dist);
    out.gain.value = far;
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

    // Boom: a low blast closing down from the muzzle, with a sub drop under it.
    if (v.boom) {
      const roar = this.noiseSource(t, BOOM_SECONDS);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(1500 * jitter * tone, t);
      lp.frequency.exponentialRampToValueAtTime(170, t + BOOM_SECONDS * 0.8);
      const rg = ctx.createGain();
      this.env(rg, t, v.boom * gainMul, 0.003, BOOM_SECONDS - 0.02);
      roar.connect(lp).connect(rg).connect(out);
      const roll = ctx.createGain();
      roll.gain.value = v.tail * 0.6 * far;
      rg.connect(roll).connect(this.reverb);
      voice.nodes.push(roll);
      this.blip(out, "sine", 96, t, 0.75 * v.boom * gainMul, 0.003, BOOM_SECONDS - 0.1, 30);
    }

    // Echo off the village walls.
    const send = ctx.createGain();
    send.gain.value = v.tail * (0.5 + Math.min(1, dist / 60)) * far;
    bg.connect(send).connect(this.reverb);
    voice.nodes.push(send);
  }

  /** The hammer falling on an empty chamber. */
  dryFire() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.clack(this.spatial(undefined, 0.1)![0], ctx.currentTime, [3000, 0.24, 520]);
  }

  click(freq = 2000, level = 0.3, pos?: V3, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const route = this.spatial(pos, 0.05, delay);
    if (!route) return;
    const [out, , voice] = route;
    const n = this.noiseSource(t, 0.03);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 4;
    const g = ctx.createGain();
    this.env(g, t, level, 0.001, 0.03);
    n.connect(bp).connect(g).connect(out);
    return voice;
  }

  /** Metal parts meeting: a bright clack, the ring above it and a short thud through the gun. */
  private clack(out: AudioNode, t: number, [freq, level, thud]: Clack) {
    this.burst(out, "bandpass", freq, 2.5, t, level, 0.001, 0.035);
    this.burst(out, "bandpass", freq * 2.3, 5, t + 0.004, level * 0.5, 0.001, 0.02);
    this.blip(out, "triangle", thud, t, level * 0.6, 0.002, 0.05, thud * 0.6);
  }

  /** The pump or bolt worked after a shot, in time with the hands. Other guns make no sound here. */
  cycle(weapon: WeaponId, pos?: V3) {
    const ctx = this.ctx;
    const action = ACTIONS[weapon], strokes = cycleStrokes(weapon);
    if (!ctx || !action || !strokes) return;
    const route = this.spatial(pos, strokes[1] + 0.1);
    if (!route) return;
    const [out, , voice] = route;
    if (!pos) this.working = voice;
    this.clack(out, ctx.currentTime + strokes[0], action[0]);
    this.clack(out, ctx.currentTime + strokes[1], action[1]);
  }

  /** The gun left the hands (swapped, reloading, dead): nothing still scheduled on it plays. */
  stopWorking() {
    for (const n of this.working?.nodes ?? []) n.disconnect();
    this.working = null;
  }

  /** Each shell seating in the port, then the pump chambering the first. */
  private shotgunReload(durationS: number) {
    const ctx = this.ctx;
    const action = ACTIONS.shotgun;
    if (!ctx || !action) return;
    const [out, , voice] = this.spatial(undefined, durationS + 0.1)!;
    this.working = voice;
    const t = ctx.currentTime;
    for (const at of SHOTGUN_RELOAD_CUES.shells) this.clack(out, t + durationS * at, SHELL_IN);
    SHOTGUN_RELOAD_CUES.rack.forEach((at, i) => this.clack(out, t + durationS * at, action[i]));
  }

  /** `need`: rounds the reload puts in (the revolver clicks once for each). */
  reload(weapon: WeaponId, durationS: number, pos?: V3, need = WEAPONS[weapon].mag) {
    if (weapon === "shotgun") return this.shotgunReload(durationS);
    if (weapon === "pistol") {
      const clicks = roundSeats(need).map((at) => this.click(2100, 0.3, pos, durationS * at)).filter((v) => !!v);
      // Your own reload's clicks can be cut short: a shot stops it with the rounds still to come.
      if (!pos && clicks.length) this.working = { ...clicks[0], nodes: clicks.flatMap((v) => v.nodes) };
      return;
    }
    // On the beats of the clip in handling.ts: the magazine dropping out, the fresh one going in
    // and seating, the charging handle hauled back and let go.
    const ctx = this.ctx;
    if (!ctx) return;
    const route = this.spatial(pos, durationS);
    if (!route) return;
    const [out, , voice] = route;
    if (!pos) this.working = voice;
    const t = ctx.currentTime;
    this.clack(out, t + durationS * 0.2, [1500, 0.12, 190]);
    this.burst(out, "bandpass", 2100, 1.2, t + durationS * 0.2 + 0.02, 0.07, 0.01, 0.07);
    this.burst(out, "bandpass", 1700, 1.2, t + durationS * 0.6, 0.06, 0.015, 0.04);
    this.clack(out, t + durationS * 0.635, [950, 0.17, 150]);
    this.clack(out, t + durationS * 0.83, [2600, 0.12, 300]);
    this.clack(out, t + durationS * 0.862, [1800, 0.17, 240]);
  }

  /** One gun put away and the other brought up: cloth and sling, then the hands closing on it. */
  switchWeapon() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.spatial(undefined, 0.3)![0];
    this.burst(out, "bandpass", 700, 0.8, t, 0.09, 0.03, 0.1);
    this.clack(out, t + 0.1, [1300, 0.09, 200]);
    this.clack(out, t + 0.17, [2400, 0.06, 320]);
  }

  /**
   * One footfall: the heel's weight, then the sole on the ground (a hard tap with grit on stone, a
   * soft crunch on earth) and the foot rolling off it. `gait` is 0 creeping .. 1 sprinting.
   */
  footstep(stone: boolean, pos?: V3, level = 0.18, gait = 0.5) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const route = this.spatial(pos, 0.14);
    if (!route) return;
    const [out] = route;
    level *= FOOTSTEP_LEVEL;
    const weight = 0.7 + gait * 0.6, vary = 0.88 + Math.random() * 0.24;
    this.blip(out, "sine", (stone ? 170 : 130) * vary, t, level * 0.22 * weight, 0.003, 0.045, 70);
    this.burst(out, "lowpass", (stone ? 520 : 380) * vary, 0.8, t, level * 1.1 * weight, 0.003, stone ? 0.045 : 0.065);
    if (stone) {
      this.burst(out, "bandpass", 1500 * vary + Math.random() * 500, 1.3, t + 0.004, level * 1.5, 0.001, 0.03);
      this.burst(out, "highpass", 3600, 0.7, t + 0.006, level * 0.3 * weight, 0.001, 0.012);
    } else {
      for (let i = 0; i < 3; i++) {
        this.burst(out, "bandpass", 650 + Math.random() * 750, 0.9, t + 0.004 + i * (0.011 + Math.random() * 0.01), level * 1.1, 0.002, 0.04);
      }
    }
    if (gait > 0.2) this.burst(out, "bandpass", stone ? 1150 * vary : 560 * vary, 1, t + 0.05 + (1 - gait) * 0.03, level * 0.6, 0.004, 0.035);
  }

  /** Landing: both feet taking the weight, and the kit settling a moment after a hard one. */
  land(level: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.spatial(undefined, 0.3)![0];
    this.blip(out, "sine", 120, t, 0.1 * level, 0.003, 0.11, 55);
    this.burst(out, "lowpass", 480, 0.8, t, 0.5 * level, 0.003, 0.12);
    this.burst(out, "bandpass", 1300, 1, t + 0.005, 0.2 * level, 0.002, 0.05);
    if (level > 0.45) {
      this.burst(out, "bandpass", 2700, 3, t + 0.05, 0.1 * level, 0.001, 0.02);
      this.burst(out, "bandpass", 3500, 3, t + 0.095, 0.07 * level, 0.001, 0.02);
    }
  }

  /** Pushing off into a jump: a boot leaving the ground and cloth pulling tight. */
  jump() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.spatial(undefined, 0.2)![0];
    this.burst(out, "lowpass", 420, 0.8, t, 0.22, 0.003, 0.05);
    this.whoosh(out, t + 0.01, 0.13, 600, 1500, 0.9, 0.09);
  }

  /**
   * Your own slide: boots and kit scraping along the ground, loud as it starts and fading as the
   * slide slows. `on` false ends it wherever it has got to.
   */
  slide(on: boolean) {
    const ctx = this.ctx;
    const was = this.sliding;
    this.sliding = null;
    if (ctx && was) {
      const t = ctx.currentTime;
      was.gain.gain.cancelScheduledValues(t);
      was.gain.gain.setTargetAtTime(0, t, 0.035);
      was.voice.end = t + 0.25;
    }
    if (!ctx || !on) return;
    const t = ctx.currentTime;
    const [out, , voice] = this.spatial(undefined, 1.4)!;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.04);
    gain.gain.linearRampToValueAtTime(0.25, t + 1.3);
    gain.connect(out);
    this.scrape(gain, t, 1.35, 0.055);
    this.blip(gain, "sine", 110, t, 0.05, 0.004, 0.1, 55);
    this.sliding = { voice, gain };
  }

  /** Someone else sliding, heard from where they are. */
  slideAt(pos: V3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const route = this.spatial(pos, 0.9);
    if (!route) return;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.04);
    gain.gain.linearRampToValueAtTime(0, t + 0.85);
    gain.connect(route[0]);
    this.scrape(gain, t, 0.9, 0.08);
  }

  /** Grit under a boot: a dull drag and a rough, wavering hiss over it. */
  private scrape(out: AudioNode, t: number, seconds: number, level: number) {
    const ctx = this.ctx!;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 600;
    const lg = ctx.createGain();
    lg.gain.value = level * 1.4;
    this.noiseLoop(t, seconds, 0.7).connect(low).connect(lg).connect(out);
    const grit = ctx.createBiquadFilter();
    grit.type = "bandpass";
    grit.Q.value = 0.8;
    grit.frequency.setValueAtTime(2600, t);
    grit.frequency.exponentialRampToValueAtTime(1300, t + seconds);
    const gg = ctx.createGain();
    gg.gain.value = level * 0.5;
    this.noiseLoop(t, seconds).connect(grit).connect(gg).connect(out);
  }

  /** Filtered noise swept from `from` Hz to `to` Hz over `seconds`, swelling and dying away. */
  private whoosh(out: AudioNode, t: number, seconds: number, from: number, to: number, q: number, peak: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const g = ctx.createGain();
    this.env(g, t, peak, seconds * 0.35, seconds * 0.65);
    this.noiseLoop(t, seconds).connect(f).connect(g).connect(out);
  }

  /**
   * A bullet striking the map: a hard smack and the surface's dull answer, a spit of dirt off
   * the ground, and now and then the round whining away off something hard.
   */
  impact(pos: V3, ground = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const whine = !ground && Math.random() < 0.18;
    const route = this.spatial(pos, whine ? 0.4 : 0.12);
    if (!route) return;
    const [out] = route;
    const t = ctx.currentTime, vary = 0.85 + Math.random() * 0.3;
    this.burst(out, "bandpass", (ground ? 900 : 2300) * vary, 1.1, t, 1.1, 0.001, ground ? 0.05 : 0.025);
    this.burst(out, "lowpass", (ground ? 300 : 520) * vary, 0.8, t, ground ? 1.6 : 0.45, 0.002, 0.06);
    if (!ground) this.burst(out, "highpass", 4500, 0.7, t + 0.002, 0.2, 0.001, 0.015);
    if (whine) {
      const from = 2600 + Math.random() * 1800;
      this.blip(out, "sine", from, t + 0.01, 0.07, 0.01, 0.3, from * 0.45);
      this.blip(out, "sine", from * 1.51, t + 0.01, 0.025, 0.01, 0.2, from * 0.7);
    }
  }

  /**
   * A bullet going past: the crack of it at `pos` (the nearest point of its flight) and the hiss
   * dropping away behind it. `closeness` is 0 at WHIZ_RANGE .. 1 past the ear.
   */
  whiz(pos: V3, closeness: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.whizAt < 0.07) return;
    const route = this.spatial(pos, 0.3);
    if (!route) return;
    this.whizAt = ctx.currentTime;
    const [out] = route;
    const t = ctx.currentTime, k = 0.45 + 0.55 * Math.max(0, Math.min(1, closeness));
    this.burst(out, "highpass", 3200, 0.7, t, 1.1 * k, 0.0005, 0.012);
    this.burst(out, "bandpass", 1800, 1, t, 0.7 * k, 0.001, 0.02);
    this.whoosh(out, t + 0.004, 0.24, 3400 + Math.random() * 800, 650, 2.2, 0.55 * k);
  }

  /** A hit on someone else, confirmed: a dry tick you can count, with a struck-helmet knock for the head. */
  hitmarker(head: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(head ? 2600 : 1500, t);
    if (!head) o.frequency.exponentialRampToValueAtTime(1050, t + 0.05);
    const g = ctx.createGain();
    this.env(g, t, head ? 0.26 : 0.22, 0.001, head ? 0.05 : 0.04);
    const out = this.spatial(undefined, head ? 0.25 : 0.1)![0];
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.08);
    this.burst(out, "bandpass", head ? 3400 : 2400, 2, t, head ? 0.2 : 0.32, 0.0005, 0.014);
    // A headshot knocks like a struck helmet, damped short, so it can't be mistaken for a body hit.
    if (head) {
      this.blip(out, "sine", 2200, t + 0.004, 0.15, 0.001, 0.11);
      this.blip(out, "sine", 3300, t + 0.004, 0.04, 0.001, 0.06);
      this.blip(out, "triangle", 420, t + 0.004, 0.1, 0.002, 0.07, 260);
    }
  }

  /** A kill streak refilled the shield: a bright charge rising to a held fifth. */
  shieldUp() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const [bus] = this.eventBus(this.sfx, 0.6, 0, 0.3);
    this.blip(bus, "triangle", 520, t, 0.12, 0.01, 0.16, 1040);
    this.blip(bus, "sine", 1040, t + 0.13, 0.1, 0.006, 0.38);
    this.blip(bus, "sine", 1560, t + 0.13, 0.06, 0.006, 0.3);
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

  /** Taking a hit: the round's smack, a thud through the body, and a dull knock that small speakers can play. */
  hurt() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.spatial(undefined, 0.3)![0];
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.2);
    const g = ctx.createGain();
    this.env(g, t, 0.42, 0.003, 0.22);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.3);
    this.blip(out, "triangle", 260, t, 0.2, 0.002, 0.08, 120);
    this.burst(out, "lowpass", 900, 0.8, t, 0.8, 0.002, 0.07);
    this.burst(out, "bandpass", 2600, 1.2, t, 0.16, 0.001, 0.02);
  }

  explosion(pos: V3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const route = this.spatial(pos, 2.4);
    if (!route) return;
    const [out, dist, voice] = route;
    const far = this.farTrim(dist);
    out.gain.value = far;
    // The detonation's own crack and punch, ahead of the roar.
    this.burst(out, "highpass", 1800, 0.7, t, 0.9, 0.001, 0.04);
    this.burst(out, "bandpass", 320, 0.8, t, 1.4, 0.002, 0.16);
    if (dist < DEAFEN_RANGE) this.deafen(1 - dist / DEAFEN_RANGE);
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
    send.gain.value = (1 + Math.min(1, dist / 40)) * far;
    g.connect(send).connect(this.reverb);
    voice.nodes.push(send);
  }

  /**
   * A blast close by: everything goes dull and comes back over a couple of seconds, with a thin
   * ringing in the ears. `amount` is 0 at the edge of DEAFEN_RANGE .. 1 at the blast.
   */
  private deafen(amount: number) {
    const ctx = this.ctx!;
    if (!this.ears?.frequency.cancelScheduledValues) return;
    const t = ctx.currentTime, k = Math.max(0, Math.min(1, amount));
    const f = this.ears.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(20000, t + 0.05);
    f.exponentialRampToValueAtTime(2600 - 2000 * k, t + 0.12);
    f.exponentialRampToValueAtTime(20000, t + 0.9 + 1.6 * k);
    const [bus] = this.eventBus(this.master, 2.4);
    this.blip(bus, "sine", 3800, t + 0.08, 0.035 * k, 0.05, 2.1);
    this.blip(bus, "sine", 5350, t + 0.08, 0.012 * k, 0.05, 1.4);
  }

  /** A grenade striking the map: a metal clink you can place by ear, louder the harder it hit. */
  grenadeHit(pos: V3, speed: number) {
    const level = Math.min(0.45, 0.14 + speed * 0.025);
    this.click(1500 + Math.random() * 500, level, pos);
    this.click(3100 + Math.random() * 700, level * 0.55, pos, 0.012);
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

  /** The arm coming over and the lever springing off as the grenade leaves the hand. */
  grenadeThrow() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.spatial(undefined, 0.3)![0];
    this.whoosh(out, t, 0.2, 500, 1700, 0.9, 0.11);
    this.clack(out, t + 0.05, [3000, 0.09, 600]);
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
  /** An enemy marked (Z): a rising two-note call, brighter when the mark is your own. */
  spot(mine: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.001;
    const [bus] = this.eventBus(this.sfx, 0.3);
    const level = mine ? 0.09 : 0.07;
    this.blip(bus, "triangle", 1250, t, level, 0.002, 0.07);
    this.blip(bus, "triangle", 1870, t + 0.07, level, 0.002, 0.14);
    this.blip(bus, "sine", 3740, t + 0.07, level * 0.3, 0.002, 0.1);
  }
  /** Z with no enemy in the sights. */
  /**
   * A dash: a gust of wind. Two bands of noise sweep up and fall away (the body of the gust and
   * the airy hiss on top), with a faint breathy whistle riding the peak. No thump: it is all air.
   * Without `pos` it is the player's own.
   */
  dash(pos?: V3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const route = this.spatial(pos, 0.9);
    if (!route) return;
    const out = route[0], voice = route[2], t = ctx.currentTime, k = pos ? 1.3 : 1;
    /** One band of wind: its centre rushes from `from` up to `peak` and settles at `to`. */
    const gust = (from: number, peak: number, to: number, q: number, level: number, attack: number, decay: number, delay = 0) => {
      const at = t + delay;
      const src = this.noiseSource(at, attack + decay);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = q;
      f.frequency.setValueAtTime(from, at);
      f.frequency.exponentialRampToValueAtTime(peak, at + attack);
      f.frequency.exponentialRampToValueAtTime(to, at + attack + decay);
      const g = ctx.createGain();
      this.env(g, at, level * k, attack, decay);
      src.connect(f).connect(g).connect(out);
      voice.nodes.push(f, g);
    };
    gust(260, 1500, 420, 0.9, 0.5, 0.07, 0.5);
    gust(1800, 6200, 2400, 1.4, 0.2, 0.05, 0.38, 0.01);
    gust(500, 900, 300, 0.6, 0.22, 0.12, 0.6, 0.04);
    this.blip(out, "sine", 620, t, 0.022 * k, 0.07, 0.3, 1500);
  }

  /** The dash is back after three kills: two quick rising notes. */
  dashReady() {
    const ctx = this.ctx;
    if (!ctx) return;
    const [bus] = this.eventBus(this.sfx, 0.5);
    const t = ctx.currentTime + 0.001;
    this.blip(bus, "triangle", 660, t, 0.07, 0.004, 0.12, 990);
    this.blip(bus, "triangle", 990, t + 0.09, 0.07, 0.004, 0.2, 1480);
    this.blip(bus, "sine", 1980, t + 0.09, 0.025, 0.004, 0.3);
  }

  /** An enemy marked the player: a low double warning tone. */
  marked() {
    const ctx = this.ctx;
    if (!ctx) return;
    const [bus] = this.eventBus(this.sfx, 0.5);
    const t = ctx.currentTime + 0.001;
    this.blip(bus, "square", 440, t, 0.035, 0.003, 0.11, 330);
    this.blip(bus, "square", 440, t + 0.16, 0.035, 0.003, 0.16, 294);
    this.blip(bus, "sine", 147, t, 0.06, 0.004, 0.3);
  }

  spotMiss() {
    const ctx = this.ctx;
    if (!ctx) return;
    const [bus] = this.eventBus(this.sfx, 0.12);
    this.blip(bus, "triangle", 520, ctx.currentTime + 0.001, 0.05, 0.002, 0.06, 380);
  }
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
    out.gain.linearRampToValueAtTime(key === "lobby" ? LOBBY_LEVEL * this.musicVolume : MAP_BED_LEVEL, t + (key === "lobby" ? 1.5 : 2.5));
    out.connect(this.master);
    const bed: Bed = { key, out, sources: [], timers: new Set() };
    switch (key) {
      case "lobby": this.lobbyBed(bed); break;
      case "downtown": this.downtownBed(bed); break;
      case "industrial": this.freightBed(bed); break;
      case "outpost": this.outpostBed(bed); break;
      // Chiba Arena: an event floor's generators, radios and TV helicopters.
      case "arena": this.outpostBed(bed); break;
      // Blockade: an open depot, the same far generator and radios as the outpost.
      case "blockade": this.outpostBed(bed); break;
      // Boulevard: a capital's avenue, the same low city rumble as downtown.
      case "street": this.downtownBed(bed); break;
      case "desert": this.desertBed(bed); break;
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

  /** Desert City: dry wind over open streets, sand hissing through in gusts, a far helicopter. */
  private desertBed(b: Bed) {
    const wind = this.loopNoise(b, "lowpass", 420, 0.6, 0.02, 0.8);
    this.lfo(b, 0.05, 0.01, wind.gain);
    this.every(b, 9000, 22000, () => this.sandGust(b), 6000);
    this.every(b, 60000, 130000, () => this.helicopter(b), 25000 + Math.random() * 20000);
  }

  private sandGust(b: Bed) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    const len = 3 + Math.random() * 3;
    const from = Math.random() * 1.6 - 0.8;
    const [bus, pan] = this.eventBus(b.out, len, from, 0.5);
    pan.pan.setValueAtTime(from, t);
    pan.pan.linearRampToValueAtTime(-from * 0.5, t + len);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(2400, t);
    f.frequency.linearRampToValueAtTime(3600, t + len * 0.5);
    f.frequency.linearRampToValueAtTime(2200, t + len);
    f.Q.value = 0.6;
    const g = ctx.createGain();
    this.swell(g, t, 0.007, len * 0.45, len);
    this.noiseLoop(t, len).connect(f).connect(g).connect(bus);
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
      // Open ground swallows the highs first: the tail darkens as it dies, instead of hissing.
      let y = 0;
      for (let i = 0; i < len; i++) {
        const a = 0.75 * Math.pow(1 - i / len, 2.2) + 0.06;
        y += a * (d[i] - y);
        d[i] = y * (1 + 1.1 * (i / len));
      }
    }
    return buf;
  }
}

/** A transfer curve that is straight for quiet signals and bends smoothly to a ceiling for loud ones. */
function softClip() {
  const n = 2049, curve = new Float32Array(n), knee = 0.6;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)) * 0.92);
  }
  return curve;
}

export const audio = new AudioEngine();
