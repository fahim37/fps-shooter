"use client";

/* eslint-disable react-hooks/immutability -- Three's renderer is an imperative external object. */

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { EffectComposer, N8AO, Bloom, ToneMapping, Vignette, SMAA, HueSaturation, BrightnessContrast } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { useSettings, PRESETS } from "../settings";

/**
 * Cinematic grade: ambient occlusion, bloom on bright highlights (muzzle flashes, sky),
 * AgX tone mapping, a light saturation/contrast lift and vignette. Low quality skips the
 * composer entirely and tone-maps in the renderer.
 */
export function PostFX() {
  const quality = useSettings((s) => s.quality);
  const clearView = useSettings((s) => s.clearView);
  const p = PRESETS[quality];
  const gl = useThree((s) => s.gl);
  const usePost = quality !== "low";

  useEffect(() => {
    gl.toneMapping = usePost ? THREE.NoToneMapping : THREE.AgXToneMapping;
    gl.toneMappingExposure = 1.05;
  }, [gl, usePost]);

  if (!usePost) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {p.ao ? (
        <N8AO aoRadius={1.6} distanceFalloff={0.6} intensity={clearView ? 1.4 : 2.4} halfRes={p.aoHalfRes} quality={p.aoHalfRes ? "medium" : "high"} />
      ) : (
        <></>
      )}
      {p.bloom ? <Bloom mipmapBlur luminanceThreshold={0.95} luminanceSmoothing={0.2} intensity={clearView ? 0.18 : 0.55} /> : <></>}
      <HueSaturation saturation={0.1} />
      <BrightnessContrast contrast={0.06} brightness={0.0} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      {clearView ? <></> : <Vignette offset={0.28} darkness={0.42} />}
      {p.smaa ? <SMAA /> : <></>}
    </EffectComposer>
  );
}
