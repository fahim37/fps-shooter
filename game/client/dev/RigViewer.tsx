"use client";

import { Suspense, use, useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import * as THREE from "three";
import { loadCharacter } from "../assets/characters";
import { EJECTION, loadWeapons } from "../assets/weapons";
import { Casings } from "../core/casings";
import { CharacterRig, type RigState } from "../player/CharacterRig";
import { HitShapes, SHAPES } from "../player/hitShapes";
import { quickScope } from "../player/quickScope";
import { hitboxes, rayVsPose } from "../../shared/hitboxes";
import { claimFits } from "../../shared/hitclaim";
import type { WeaponId } from "../../shared/weapons";
import type { OpticId } from "../../shared/optics";
import { gunSideView, gunTopView, handLayout, solveGrips } from "./gripSolver";

const WEAPONS: WeaponId[] = ["ar", "smg", "shotgun", "sniper", "pistol"];

function Rigs({ pitch, speed, reload, ads, shot, draw, solo, move, weapon }: { pitch: number; speed: number; reload: number; ads: number; shot: number; draw: number; solo: boolean; move: number; weapon: WeaponId }) {
  const template = use(loadCharacter());
  const weapons = use(loadWeapons());
  // Two per gun, one of each team, side by side.
  const rigs = useMemo(() => (solo ? [weapon] : WEAPONS).flatMap((w) => (solo ? [1] : [1, 2]).map((team) => {
    const r = new CharacterRig(template, weapons, team, "tpp");
    r.setWeapon(w);
    return r;
  })), [template, weapons, solo, weapon]);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    (window as unknown as { __rigs: CharacterRig[]; THREE: typeof THREE }).__rigs = rigs;
    (window as unknown as { THREE: typeof THREE }).THREE = THREE;
    // For scripts/dev/hit-accuracy.ts: the hit shapes and shared ray tests, as the game uses them.
    (window as unknown as { __hit: unknown }).__hit = { HitShapes, SHAPES, rayVsPose, hitboxes, claimFits };
    rigs.forEach((r) => scene.add(r.object));
    return () => rigs.forEach((r) => r.dispose());
  }, [rigs, scene]);
  useFrame((_, dt) => {
    rigs.forEach((r, i) => {
      const s: RigState = {
        x: solo ? 0 : (Math.floor(i / 2) - 2) * 1.3, y: 0, z: solo ? 0 : (i % 2) * 1.7, yaw: Math.PI * 0.75, pitch, speed, moveYaw: Math.PI * 0.75 + move,
        crouch: false, grounded: true, alive: true, sprint: 0, ads, reload, sinceShot: shot, sinceDraw: draw,
      };
      r.update(Math.min(dt, 0.05), s);
    });
  });
  return null;
}

const FPP_EYE = new THREE.Vector3(0, 1.62, 0);

/** For scripts/dev/grip-bake.ts: solves a gun's hand poses here, where the real meshes are loaded. */
if (typeof window !== "undefined") {
  (window as unknown as { __grips: unknown }).__grips = {
    bake: async (weapon: WeaponId) => solveGrips(await loadCharacter(), await loadWeapons(), weapon),
    hand: async () => handLayout(await loadCharacter()),
    sideView: async (weapon: WeaponId, y: [number, number], z: [number, number], step?: number, x?: number, halfWidth?: number) =>
      gunSideView(await loadWeapons(), weapon, y, z, step, x, halfWidth),
    topView: async (weapon: WeaponId, y: number, x: [number, number], z: [number, number], step?: number) =>
      gunTopView(await loadWeapons(), weapon, y, x, z, step),
  };
}

const _at = new THREE.Vector3(), _turn = new THREE.Quaternion(), _still = new THREE.Vector3();

function FppRig({ weapon, optic, ads, pitch, reload, orbit, shot, draw, raise, fire }: { weapon: WeaponId; optic?: OpticId; ads: number; pitch: number; reload: number; orbit: boolean; shot: number; draw: number; raise?: "up" | "down"; fire: number }) {
  const template = use(loadCharacter());
  const weapons = use(loadWeapons());
  const rig = useMemo(() => {
    const r = new CharacterRig(template, weapons, 1, "fpp", true);
    r.setWeapon(weapon);
    return r;
  }, [template, weapons, weapon]);
  const { scene, camera } = useThree();
  const casings = useMemo(() => new Casings(), []);
  useEffect(() => {
    (window as unknown as { __rigs: CharacterRig[]; THREE: typeof THREE }).__rigs = [rig];
    (window as unknown as { THREE: typeof THREE }).THREE = THREE;
    scene.add(rig.object, casings.mesh);
    return () => { rig.dispose(); scene.remove(casings.mesh); };
  }, [rig, scene, casings]);
  const view = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, 0, "YXZ")), [pitch]);
  useFrame((state, dt) => {
    // Orbit mode inspects the viewmodel from outside; the rig still sees the player's eye.
    if (!orbit) {
      camera.position.copy(FPP_EYE);
      camera.quaternion.copy(view);
      camera.updateMatrixWorld();
    }
    rig.update(Math.min(dt, 0.05), {
      x: 0, y: 0, z: 0, yaw: 0, pitch, eye: FPP_EYE, view, optic,
      speed: 0, moveYaw: 0, crouch: false, grounded: true, alive: true, sprint: 0, reload, sinceDraw: draw,
      // &fire=rpm keeps shooting at that rate, to watch the gun kick.
      sinceShot: fire > 0 ? state.clock.elapsedTime % (60 / fire) : shot,
      // &raise=up|down: `ads` is the linear raise progress, drawn with the quick-scope move.
      ads: raise ? THREE.MathUtils.smoothstep(ads, 0, 1) : ads,
      quickScope: raise ? quickScope(weapon, ads, raise === "up", optic) : undefined,
    });
    // Spent cases, as the game throws them.
    const ejection = EJECTION[weapon];
    if (rig.ejected && ejection) casings.eject(rig.gunToWorld(ejection.port, _at, _turn), _turn, _still, ejection, 0);
    casings.update(Math.min(dt, 0.05));
  });
  return null;
}

export default function RigViewer(props: { fire: number; raise?: "up" | "down"; optic?: OpticId; fpp: boolean; orbit: boolean; solo: boolean; move: number; weapon: WeaponId; pitch: number; speed: number; reload: number; ads: number; shot: number; draw: number; fov: number; cam: [number, number, number]; target?: [number, number, number] }) {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas shadows camera={{ position: props.cam, fov: props.fpp && !props.orbit ? props.fov : 40, near: 0.02 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={["#9aa6ad"]} />
        <directionalLight position={[3, 6, 4]} intensity={2.5} castShadow />
        <Suspense fallback={null}>
          <Environment preset="city" />
          {props.fpp ? <FppRig raise={props.raise} weapon={props.weapon} optic={props.optic} ads={props.ads} pitch={props.pitch} reload={props.reload} orbit={props.orbit} shot={props.shot} draw={props.draw} fire={props.fire} /> : <Rigs {...props} />}
        </Suspense>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#777" />
        </mesh>
        {props.fpp && !props.orbit ? null : <OrbitControls target={props.target ?? (props.fpp ? [0.06, 1.42, -0.42] : [0, 1.1, 0])} />}
      </Canvas>
    </div>
  );
}
