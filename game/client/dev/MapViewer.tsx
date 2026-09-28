"use client";

import { Suspense, useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { SkyAndSun } from "../world/SkyAndSun";
import { Ground } from "../world/Ground";
import { StaticWorld } from "../world/StaticWorld";
import { PostFX } from "../world/PostFX";
import { getVillage } from "../../shared/map/village";
import { useSettings, type Quality } from "../settings";

export default function MapViewer({ cam, target, quality }: { cam: [number, number, number]; target: [number, number, number]; quality?: Quality }) {
  const map = useMemo(() => getVillage(), []);
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
          <Ground />
          <StaticWorld map={map} />
          <PostFX />
        </Suspense>
        <OrbitControls target={target} />
      </Canvas>
      <div style={{ position: "fixed", left: 8, top: 8, color: "#fff", font: "12px monospace", textShadow: "0 1px 2px #000" }}>
        {map.pieces.length} pieces
      </div>
    </div>
  );
}
