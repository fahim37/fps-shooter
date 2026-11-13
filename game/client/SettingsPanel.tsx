"use client";
import { memo, useId, type CSSProperties } from "react";
import { useSettings, QUALITY_ORDER, SENSITIVITY_RANGE, TUNING_DEFAULTS, type Quality } from "./settings";

const QUALITY_LABEL: Record<Quality, string> = { low: "Low", medium: "Med", high: "High", ultra: "Ultra" };
/** What each tier trades: Low is the fast one, and says so. */
const QUALITY_NOTE: Record<Quality, string> = { low: "Best FPS", medium: "Balanced", high: "Sharper", ultra: "Best looks" };

/**
 * A gauge-style slider: ticks light up as the fill passes them, the thumb glows and shows a value
 * bubble while held, and a notch marks the default (with a reset once you move off it). The real
 * range input sits invisibly on top, so dragging, keys and screen readers behave natively.
 * All motion is CSS and only runs while someone interacts.
 */
function Slider({ label, value, fallback, format, min, max, step = 1, index, onChange }: {
  label: string; value: number; fallback: number; format: (value: number) => string; min: number; max: number; step?: number; index: number; onChange: (value: number) => void;
}) {
  const id = useId();
  const text = format(value);
  const changed = Math.abs(value - fallback) > step / 2;
  const style = { "--p": (value - min) / (max - min), "--d": (fallback - min) / (max - min), "--i": index } as CSSProperties;
  return <div className="qs" style={style} data-changed={changed || undefined}>
    <div className="qs-head">
      <span id={`${id}-label`}>{label}</span>
      <span className="qs-readout">
        {changed && <button type="button" className="qs-reset" onClick={() => onChange(fallback)} aria-label={`Reset ${label.toLowerCase()} to ${format(fallback)}`} title={`Reset to ${format(fallback)}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" /><path d="M4.4 1.9v2.8h2.8" /></svg>
        </button>}
        <output key={text} htmlFor={id} className="qs-value" aria-hidden="true">{text}</output>
      </span>
    </div>
    <div className="qs-track">
      <div className="qs-gauge" aria-hidden="true">
        <span className="qs-rail" />
        <span className="qs-fill" />
        <span className="qs-default" />
        <span className="qs-thumb"><span className="qs-bubble">{text}</span></span>
      </div>
      <input id={id} type="range" aria-labelledby={`${id}-label`} aria-valuetext={text} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  </div>;
}

/** The settings players change most, right in the home lobby; everything else stays in the dialog. */
export const QuickSettings = memo(function QuickSettings({ onMore }: { onMore: () => void }) {
  const s = useSettings();
  return <section className="quick-settings" aria-label="Quick settings">
    <div className="quick-settings-head"><span className="field-caption">QUICK SETTINGS</span><button type="button" className="text-button" onClick={onMore}>All settings →</button></div>
    <Slider index={0} label="Sensitivity" value={s.sensitivity} fallback={TUNING_DEFAULTS.sensitivity} format={(v) => v.toFixed(2)} min={SENSITIVITY_RANGE.min} max={SENSITIVITY_RANGE.max} step={SENSITIVITY_RANGE.step} onChange={(sensitivity) => s.set({ sensitivity })} />
    <Slider index={1} label="ADS sensitivity" value={s.adsSensitivity} fallback={TUNING_DEFAULTS.adsSensitivity} format={(v) => v.toFixed(1)} min={0.2} max={1.5} step={0.1} onChange={(adsSensitivity) => s.set({ adsSensitivity })} />
    <Slider index={2} label="Field of view" value={s.fov} fallback={TUNING_DEFAULTS.fov} format={(v) => `${v}°`} min={60} max={110} onChange={(fov) => s.set({ fov })} />
    <Slider index={3} label="Volume" value={s.volume} fallback={TUNING_DEFAULTS.volume} format={(v) => `${Math.round(v * 100)}%`} min={0} max={1} step={0.05} onChange={(volume) => s.set({ volume })} />
    <Slider index={4} label="Lobby music" value={s.musicVolume} fallback={TUNING_DEFAULTS.musicVolume} format={(v) => v ? `${Math.round(v * 100)}%` : "Off"} min={0} max={1} step={0.05} onChange={(musicVolume) => s.set({ musicVolume })} />
    <QualitySeg hint="F6 cycles in a match" />
  </section>;
});

/** Graphics tiers as a segmented control with a lit pill that slides to the pick. */
function QualitySeg({ hint }: { hint: string }) {
  const quality = useSettings((s) => s.quality);
  const id = useId();
  const at = QUALITY_ORDER.indexOf(quality);
  return <div className="qs-quality">
    <span className="field-caption" id={id}>GRAPHICS<em>{hint}</em></span>
    <div className="qs-seg" role="radiogroup" aria-labelledby={id} style={{ "--n": QUALITY_ORDER.length, "--at": Math.max(0, at) } as CSSProperties}>
      <span className="qs-seg-pill" aria-hidden="true" />
      {QUALITY_ORDER.map((q) => <button type="button" role="radio" key={q} aria-checked={quality === q} aria-label={`${QUALITY_LABEL[q]}: ${QUALITY_NOTE[q].toLowerCase()}`} onClick={() => useSettings.getState().set({ quality: q })}>
        <span className="qs-tier"><b>{QUALITY_LABEL[q]}</b><small>{QUALITY_NOTE[q]}</small></span>
      </button>)}
    </div>
  </div>;
}

/** Every in-match setting, right in the pause menu: no dialog to open mid-fight. */
export const MatchSettings = memo(function MatchSettings() {
  const s = useSettings();
  return <section className="match-settings" aria-label="Match settings">
    <div className="match-settings-sliders">
      <Slider index={0} label="Sensitivity" value={s.sensitivity} fallback={TUNING_DEFAULTS.sensitivity} format={(v) => v.toFixed(2)} min={SENSITIVITY_RANGE.min} max={SENSITIVITY_RANGE.max} step={SENSITIVITY_RANGE.step} onChange={(sensitivity) => s.set({ sensitivity })} />
      <Slider index={1} label="ADS sensitivity" value={s.adsSensitivity} fallback={TUNING_DEFAULTS.adsSensitivity} format={(v) => v.toFixed(1)} min={0.2} max={1.5} step={0.1} onChange={(adsSensitivity) => s.set({ adsSensitivity })} />
      <Slider index={2} label="Field of view" value={s.fov} fallback={TUNING_DEFAULTS.fov} format={(v) => `${v}°`} min={60} max={110} onChange={(fov) => s.set({ fov })} />
      <Slider index={3} label="Volume" value={s.volume} fallback={TUNING_DEFAULTS.volume} format={(v) => `${Math.round(v * 100)}%`} min={0} max={1} step={0.05} onChange={(volume) => s.set({ volume })} />
    </div>
    <QualitySeg hint="F6 cycles while playing" />
    <div className="match-settings-checks">
      <label className="check-label"><input type="checkbox" checked={s.adaptiveResolution} onChange={(e) => s.set({ adaptiveResolution: e.target.checked })} /> Adaptive resolution</label>
      <label className="check-label"><input type="checkbox" checked={s.fpsMeter} onChange={(e) => s.set({ fpsMeter: e.target.checked })} /> FPS meter</label>
      <label className="check-label"><input type="checkbox" checked={s.thirdPerson} onChange={(e) => s.set({ thirdPerson: e.target.checked })} /> Third-person camera</label>
      <label className="check-label"><input type="checkbox" checked={s.leanToggle} onChange={(e) => s.set({ leanToggle: e.target.checked })} /> Toggle peek (Q / E)</label>
      <label className="check-label" title="Less bloom and shadow contrast, no darkened edges while aiming"><input type="checkbox" checked={s.clearView} onChange={(e) => s.set({ clearView: e.target.checked })} /> Clearer combat view</label>
    </div>
  </section>;
});
export const SettingsPanel = memo(function SettingsPanel() {
  const s = useSettings();
  return <div className="settings-grid">
    <label>QUALITY<select value={s.quality} onChange={(e) => s.set({ quality: e.target.value as Quality })}>{QUALITY_ORDER.map((q) => <option key={q} value={q}>{q} · {QUALITY_NOTE[q].toLowerCase()}</option>)}</select></label>
    <label>VOLUME {Math.round(s.volume * 100)}%<input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => s.set({ volume: Number(e.target.value) })} /></label>
    <label>LOBBY MUSIC {s.musicVolume ? `${Math.round(s.musicVolume * 100)}%` : "OFF"}<input type="range" min={0} max={1} step={0.05} value={s.musicVolume} onChange={(e) => s.set({ musicVolume: Number(e.target.value) })} /></label>
    <label>SENSITIVITY {s.sensitivity.toFixed(2)}<input type="range" min={SENSITIVITY_RANGE.min} max={SENSITIVITY_RANGE.max} step={SENSITIVITY_RANGE.step} value={s.sensitivity} onChange={(e) => s.set({ sensitivity: Number(e.target.value) })} /></label>
    <label>ADS SENSITIVITY {s.adsSensitivity.toFixed(1)}<input type="range" min={0.2} max={1.5} step={0.1} value={s.adsSensitivity} onChange={(e) => s.set({ adsSensitivity: Number(e.target.value) })} /></label>
    <label>FIELD OF VIEW {s.fov}°<input type="range" min={60} max={110} value={s.fov} onChange={(e) => s.set({ fov: Number(e.target.value) })} /></label>
    <label className="check-label"><input type="checkbox" checked={s.thirdPerson} onChange={(e) => s.set({ thirdPerson: e.target.checked })} /> Third-person camera</label>
    <label className="check-label"><input type="checkbox" checked={s.leanToggle} onChange={(e) => s.set({ leanToggle: e.target.checked })} /> Toggle peek (Q / E)</label>
    <label className="check-label"><input type="checkbox" checked={s.fpsMeter} onChange={(e) => s.set({ fpsMeter: e.target.checked })} /> FPS meter</label>
    <label className="check-label"><input type="checkbox" checked={s.adaptiveResolution} onChange={(e) => s.set({ adaptiveResolution: e.target.checked })} /> Auto-adjust resolution</label>
    <label className="check-label"><input type="checkbox" checked={s.clearView} onChange={(e) => s.set({ clearView: e.target.checked })} /> Clearer combat view</label>
    <p className="controls-help settings-note">Clearer combat view reduces bloom and shadow contrast, and removes darkened screen edges while aiming.</p>
    <p className="controls-help settings-note">Graphics apply immediately. Press F6 during a match to cycle quality. Auto resolution helps keep play smooth when your PC is busy.</p>
  </div>;
});
