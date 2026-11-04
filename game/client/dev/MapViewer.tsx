"use client";

/* eslint-disable react-hooks/immutability -- The renderer's info counters are imperative Three state. */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
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

/** Everything above `clip` meters is cut away, to see a level of a town from above. */
function ClipAbove({ clip }: { clip: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    gl.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), clip)];
    return () => { gl.clippingPlanes = []; };
  }, [gl, clip]);
  // Cut walls show their insides, drawn dark so the plan reads as walls and floors.
  useFrame(() => {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || m.side === THREE.DoubleSide || !(o as THREE.Mesh).isMesh) return;
      m.side = THREE.DoubleSide;
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  if (!gl_FrontFacing) gl_FragColor = vec4(0.08, 0.05, 0.1, 1.0);");
      };
      m.needsUpdate = true;
    });
  });
  return null;
}

function PlanCamera({ plan: [x, z, width] }: { plan: [number, number, number] }) {
  const size = useThree((s) => s.size);
  return (
    <OrthographicCamera makeDefault position={[x, 80, z]} up={[0, 0, -1]} zoom={size.width / width} near={1} far={200}
      onUpdate={(c) => c.lookAt(x, 0, z)} />
  );
}

export default function MapViewer({ map: mapId, cam, target, quality, plan, clip }: {
  map?: string; cam: [number, number, number]; target: [number, number, number]; quality?: Quality;
  /** Straight-down orthographic view: center x, z and the visible width in meters. */
  plan?: [number, number, number];
  clip?: number;
}) {
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
        {clip !== undefined && <ClipAbove clip={clip} />}
        {plan ? (
          <PlanCamera plan={plan} />
        ) : (
          <OrbitControls target={target} />
        )}
      </Canvas>
      <div style={{ position: "fixed", left: 8, top: 8, color: "#fff", font: "12px monospace", textShadow: "0 1px 2px #000" }}>
        {map.id} · {map.pieces.length} pieces{stats}
      </div>
    </div>
  );
}
