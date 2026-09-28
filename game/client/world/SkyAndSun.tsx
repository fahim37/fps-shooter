"use client";

/* eslint-disable react-hooks/immutability -- Scene, lights and vectors are imperative Three objects. */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { useSettings, PRESETS } from "../settings";
import { windUniforms } from "./wind";
import { assetUrl } from "../assets/url";

/** Direction toward the sun (late afternoon, matches the warm light in the HDRI). */
export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.42).normalize();
const FOG_COLOR = new THREE.Color("#aebfcc");

/**
 * HDRI sky + image-based lighting, a shadow-casting sun that follows the camera, and haze.
 */
export function SkyAndSun() {
  const quality = useSettings((s) => s.quality);
  const p = PRESETS[quality];
  const { scene, camera } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    scene.fog = new THREE.Fog(FOG_COLOR, p.drawDistance * 0.45, p.drawDistance * 1.3);
    return () => { scene.fog = null; };
  }, [scene, p.drawDistance]);

  useEffect(() => {
    scene.add(target);
    return () => { scene.remove(target); };
  }, [scene, target]);

  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
    const cam = light.shadow.camera;
    cam.left = cam.bottom = -p.shadowExtent;
    cam.right = cam.top = p.shadowExtent;
    cam.near = 1;
    cam.far = 220;
    cam.updateProjectionMatrix();
    light.shadow.map?.dispose();
    light.shadow.map = null;
  }, [p.shadowMapSize, p.shadowExtent]);

  const snap = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    windUniforms.uWindTime.value += dt;
    const light = sun.current;
    if (!light) return;
    // Keep the shadow frustum centered slightly ahead of the camera, snapped to shadow
    // texels so edges don't shimmer as the player moves.
    camera.getWorldDirection(snap);
    snap.y = 0;
    snap.normalize().multiplyScalar(p.shadowExtent * 0.45).add(camera.position);
    const texel = (p.shadowExtent * 2) / p.shadowMapSize;
    snap.x = Math.round(snap.x / texel) * texel;
    snap.z = Math.round(snap.z / texel) * texel;
    snap.y = 0;
    target.position.copy(snap);
    light.position.copy(snap).addScaledVector(SUN_DIR, 120);
    light.target = target;
  });

  return (
    <>
      <Environment
        files={assetUrl(`/env/sky_${p.hdri}.hdr`)}
        background
        environmentIntensity={0.85}
        backgroundIntensity={1}
        backgroundRotation={[0, Math.PI * 0.2, 0]}
        environmentRotation={[0, Math.PI * 0.2, 0]}
      />
      <directionalLight
        ref={sun}
        color="#ffe9cf"
        intensity={3.1}
        castShadow={p.shadows}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
      />
      <hemisphereLight args={["#dfe9f2", "#4b4a3a", 0.25]} />
    </>
  );
}
