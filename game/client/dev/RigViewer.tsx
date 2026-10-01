"use client";

import { Suspense, use, useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import * as THREE from "three";
import { loadCharacters } from "../assets/characters";
import { loadWeapons } from "../assets/weapons";
import { CharacterRig, type RigState } from "../player/CharacterRig";
import type { WeaponId } from "../../shared/weapons";

const WEAPONS: WeaponId[] = ["ar", "smg", "shotgun", "sniper", "pistol"];

function Rigs({ pitch, speed, reload, ads }: { pitch: number; speed: number; reload: number; ads: number }) {
  const [male, female] = use(loadCharacters());
  const weapons = use(loadWeapons());
  const rigs = useMemo(() => WEAPONS.flatMap((w) => [male, female].map((template, gender) => {
    const r = new CharacterRig(template, weapons, gender + 1, gender === 0, "tpp");
    r.setWeapon(w);
    return r;
  })), [male, female, weapons]);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    (window as unknown as { __rigs: CharacterRig[]; THREE: typeof THREE }).__rigs = rigs;
    (window as unknown as { THREE: typeof THREE }).THREE = THREE;
    rigs.forEach((r) => scene.add(r.object));
    return () => rigs.forEach((r) => r.dispose());
  }, [rigs, scene]);
  useFrame((_, dt) => {
    rigs.forEach((r, i) => {
      const s: RigState = {
        x: (Math.floor(i / 2) - 2) * 1.3, y: 0, z: (i % 2) * 1.7, yaw: Math.PI * 0.75, pitch, speed, moveYaw: Math.PI * 0.75,
        crouch: false, grounded: true, alive: true, sprint: 0, ads, reload, recoil: 0,
      };
      r.update(Math.min(dt, 0.05), s);
    });
  });
  return null;
}

function FppRig({ weapon, ads, pitch }: { weapon: WeaponId; ads: number; pitch: number }) {
  const [male] = use(loadCharacters());
  const weapons = use(loadWeapons());
  const rig = useMemo(() => {
    const r = new CharacterRig(male, weapons, 1, false, "fpp");
    r.setWeapon(weapon);
    return r;
  }, [male, weapons, weapon]);
  const { scene, camera } = useThree();
  useEffect(() => {
    (window as unknown as { __rigs: CharacterRig[] }).__rigs = [rig];
    scene.add(rig.object);
    return () => rig.dispose();
  }, [rig, scene]);
  useFrame((_, dt) => {
    camera.position.set(0, 1.62, 0);
    camera.rotation.set(pitch, 0, 0, "YXZ");
    camera.updateMatrixWorld();
    rig.update(Math.min(dt, 0.05), {
      x: 0, y: 0, z: 0, yaw: 0, pitch, eye: camera.position.clone(), view: camera.quaternion.clone(),
      speed: 0, moveYaw: 0, crouch: false, grounded: true, alive: true, sprint: 0, ads, reload: -1, recoil: 0,
    });
  });
  return null;
}

export default function RigViewer(props: { fpp: boolean; weapon: WeaponId; pitch: number; speed: number; reload: number; ads: number; cam: [number, number, number] }) {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas shadows camera={{ position: props.cam, fov: props.fpp ? 78 : 40, near: 0.02 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={["#9aa6ad"]} />
        <directionalLight position={[3, 6, 4]} intensity={2.5} castShadow />
        <Suspense fallback={null}>
          <Environment preset="city" />
          {props.fpp ? <FppRig weapon={props.weapon} ads={props.ads} pitch={props.pitch} /> : <Rigs {...props} />}
        </Suspense>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#777" />
        </mesh>
        {props.fpp ? null : <OrbitControls target={[0, 1.1, 0]} />}
      </Canvas>
    </div>
  );
}
