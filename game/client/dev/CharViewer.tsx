"use client";

import { Suspense, use, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import * as THREE from "three";
import { loadCharacters, instantiateCharacter, type ClipName } from "../assets/characters";

function Char({ index, team, clip, x, axes }: { index: 0 | 1; team: number; clip: ClipName; x: number; axes: boolean }) {
  const [male, female] = use(loadCharacters());
  const tpl = index === 0 ? male : female;
  const inst = useMemo(() => instantiateCharacter(tpl, team, index === 0), [tpl, team, index]);
  const mixer = useMemo(() => new THREE.AnimationMixer(inst.root), [inst]);
  useEffect(() => {
    const a = mixer.clipAction(tpl.full.get(clip)!);
    a.play();
    if (axes) {
      for (const b of ["hand_r", "hand_l", "Head", "spine_03"]) inst.bones.get(b)?.add(new THREE.AxesHelper(0.25));
    }
    return () => { mixer.stopAllAction(); };
  }, [mixer, tpl, clip, inst, axes]);
  useFrame((_, dt) => mixer.update(dt));
  return <primitive object={inst.root} position={[x, 0, 0]} />;
}

export default function CharViewer({ clip, cam, target, axes }: { clip: ClipName; cam: [number, number, number]; target: [number, number, number]; axes: boolean }) {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas shadows camera={{ position: cam, fov: 40 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={["#9aa6ad"]} />
        <directionalLight position={[3, 6, 4]} intensity={2.5} castShadow />
        <Suspense fallback={null}>
          <Environment preset="city" />
          <Char index={0} team={1} clip={clip} x={-0.6} axes={axes} />
          <Char index={1} team={2} clip={clip} x={0.6} axes={axes} />
        </Suspense>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#777" />
        </mesh>
        <OrbitControls target={target} />
      </Canvas>
    </div>
  );
}
