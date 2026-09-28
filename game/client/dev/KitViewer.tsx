"use client";

import { Suspense, use, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Environment } from "@react-three/drei";
import * as THREE from "three";
import { loadKit } from "../assets/kits";
import type { KitName } from "../../shared/map/types";

function PieceGrid({ kitName, filter, spacing }: { kitName: KitName; filter: string; spacing: number }) {
  const kit = use(loadKit(kitName));
  const pieces = useMemo(
    () => [...kit.values()].filter((p) => !filter || new RegExp(filter, "i").test(p.name)),
    [kit, filter],
  );
  const cols = Math.ceil(Math.sqrt(pieces.length));
  return (
    <group>
      {pieces.map((piece, i) => {
        const x = (i % cols) * spacing;
        const z = Math.floor(i / cols) * spacing;
        return (
          <group key={piece.name} position={[x, 0, z]}>
            {piece.parts.map((part, j) => (
              <mesh
                key={j}
                geometry={part.geometry}
                material={part.material}
                matrixAutoUpdate={false}
                matrix={part.matrix}
                castShadow
                receiveShadow
              />
            ))}
            {/* +X red, +Z blue axis markers at the piece origin */}
            <mesh position={[0.5, 0.02, 0]}>
              <boxGeometry args={[1, 0.04, 0.04]} />
              <meshBasicMaterial color="red" />
            </mesh>
            <mesh position={[0, 0.02, 0.5]}>
              <boxGeometry args={[0.04, 0.04, 1]} />
              <meshBasicMaterial color="blue" />
            </mesh>
            <Text position={[0, 0.05, spacing * 0.42]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.35} color="black">
              {piece.name}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

export default function KitViewer({ kit, filter, spacing, cam, target }: { kit: KitName; filter: string; spacing: number; cam: [number, number, number]; target: [number, number, number] }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#bcd" }}>
      <Canvas shadows camera={{ position: cam, fov: 50, far: 2000 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={["#c8d4dc"]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[30, 50, 20]} intensity={2.5} castShadow />
        <Suspense fallback={null}>
          <Environment preset="park" />
          <PieceGrid kitName={kit} filter={filter} spacing={spacing} />
        </Suspense>
        <gridHelper args={[400, 200, "#888", "#aaa"]} position={[0, 0.001, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[400, 400]} />
          <meshStandardMaterial color={new THREE.Color("#d8d8d0")} />
        </mesh>
        <OrbitControls target={target} />
      </Canvas>
    </div>
  );
}
