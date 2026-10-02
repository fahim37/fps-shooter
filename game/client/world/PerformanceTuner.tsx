"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useHud } from "../core/hud";
import { PRESETS, useSettings } from "../settings";
import { ResolutionGovernor } from "./resolution";

/** Changes render resolution without changing the selected effects or reconnecting the match. */
export function PerformanceTuner() {
  const quality = useSettings((s) => s.quality);
  const enabled = useSettings((s) => s.adaptiveResolution);
  const setDpr = useThree((s) => s.setDpr);
  const p = PRESETS[quality];
  const governor = useMemo(() => new ResolutionGovernor(p.dpr, enabled ? p.minDpr : p.dpr), [p.dpr, p.minDpr, enabled]);

  useEffect(() => { setDpr(p.dpr); }, [setDpr, p.dpr, enabled]);
  useFrame((_, dt) => {
    if (!enabled) return;
    const h = useHud.getState();
    if (!h.ready || h.conn !== "connected" || h.phase === "ended" || h.menu || h.loadoutOpen || h.customizingControls || (!h.locked && !h.touch) || document.hidden) { governor.pause(); return; }
    const next = governor.sample(dt);
    if (next !== null) setDpr(next);
  });
  return null;
}
