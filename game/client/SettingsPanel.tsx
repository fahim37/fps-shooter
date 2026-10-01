"use client";
import { useSettings, type Quality } from "./settings";
export function SettingsPanel() {
  const s = useSettings();
  return <div className="settings-grid">
    <label>QUALITY<select value={s.quality} onChange={(e) => s.set({ quality: e.target.value as Quality })}>{["low", "medium", "high", "ultra"].map((q) => <option key={q}>{q}</option>)}</select></label>
    <label>VOLUME {Math.round(s.volume * 100)}%<input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => s.set({ volume: Number(e.target.value) })} /></label>
    <label>SENSITIVITY {s.sensitivity.toFixed(1)}<input type="range" min={0.2} max={3} step={0.1} value={s.sensitivity} onChange={(e) => s.set({ sensitivity: Number(e.target.value) })} /></label>
    <label>ADS SENSITIVITY {s.adsSensitivity.toFixed(1)}<input type="range" min={0.2} max={1.5} step={0.1} value={s.adsSensitivity} onChange={(e) => s.set({ adsSensitivity: Number(e.target.value) })} /></label>
    <label>FIELD OF VIEW {s.fov}°<input type="range" min={60} max={110} value={s.fov} onChange={(e) => s.set({ fov: Number(e.target.value) })} /></label>
    <label className="check-label"><input type="checkbox" checked={s.thirdPerson} onChange={(e) => s.set({ thirdPerson: e.target.checked })} /> Third-person camera</label>
    <label className="check-label"><input type="checkbox" checked={s.showFps} onChange={(e) => s.set({ showFps: e.target.checked })} /> Show performance</label>
    <label className="check-label"><input type="checkbox" checked={s.adaptiveResolution} onChange={(e) => s.set({ adaptiveResolution: e.target.checked })} /> Auto-adjust resolution</label>
    <p className="controls-help settings-note">Graphics apply immediately. Press F6 during a match to cycle quality. Auto resolution helps keep play smooth when your PC is busy.</p>
  </div>;
}
