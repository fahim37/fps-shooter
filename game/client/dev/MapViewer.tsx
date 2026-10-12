"use client";

/* eslint-disable react-hooks/immutability -- The renderer's info counters are imperative Three state. */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { SkyAndSun } from "../world/SkyAndSun";
import { Ground } from "../world/Ground";
import { StaticWorld } from "../world/StaticWorld";
import { PostFX } from "../world/PostFX";
import { getMap } from "../../shared/map/maps";
import { useSettings, type Quality } from "../settings";

/**
 * Draw calls and triangles of the whole previous frame (scene, shadows and post passes), for
 * budgeting maps. Also published on window.__mapStats for scripts.
 */
function RenderStats({ onStats }: { onStats: (text: string) => void }) {
  const gl = useThree((s) => s.gl);
  const timer = useRef(0);
  useEffect(() => {
    // Post-processing renders several times per frame; accumulate instead of keeping the last pass.
    const info = gl.info;
    info.autoReset = false;
    return () => { info.autoReset = true; };
  }, [gl]);
  useFrame((_, dt) => {
    const { calls, triangles } = gl.info.render;
    gl.info.reset();
    timer.current -= dt;
    if (timer.current > 0) return;
    timer.current = 0.5;
    (window as unknown as { __mapStats: unknown }).__mapStats = { calls, triangles, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries };
    onStats(` · ${calls} draw calls · ${(triangles / 1000).toFixed(0)}k triangles`);
  }, -1);
  return null;
}

export default function MapViewer({ map: mapId, cam, target, quality }: { map?: string; cam: [number, number, number]; target: [number, number, number]; quality?: Quality }) {
  const map = useMemo(() => getMap(mapId), [mapId]);
  const [stats, setStats] = useState("");
  useEffect(() => {
    if (quality) useSettings.getState().set({ quality });
  }, [quality]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <Canvas
        shadows={{ enabled: true, type: THREE.PCFShadowMap }}
        dpr={1}
        camera={{ position: cam, fov: 70, near: 0.1, far: 600 }}
        gl={{ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true }}
      >
        <Suspense fallback={null}>
          <SkyAndSun />
          <Ground map={map.id} />
          <StaticWorld map={map} />
          <PostFX />
          <RenderStats onStats={setStats} />
        </Suspense>
        <OrbitControls target={target} />
      </Canvas>
      <div style={{ position: "fixed", left: 8, top: 8, color: "#fff", font: "12px monospace", textShadow: "0 1px 2px #000" }}>
        {map.id} · {map.pieces.length} pieces{stats}
      </div>
    </div>
  );
}
