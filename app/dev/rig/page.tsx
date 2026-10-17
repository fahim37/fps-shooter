import RigViewer from "./RigViewerLoader";
import type { WeaponId } from "@/game/shared/weapons";

// Dev tool: weapon-holding rigs. /dev/rig?pitch=0&speed=0&reload=-1  or  /dev/rig?fpp=1&weapon=ar&ads=0
// &shot=s / &draw=s hold the pump or bolt cycle / weapon draw that many seconds in.
// &solo=1 shows only the male rig holding &weapon (TPP), &move=rad turns its movement off the aim.
// Add &orbit=1&cam=x,y,z[&target=x,y,z] to view the first-person arms from outside, &fov=n for the FPP camera.
export default async function RigPage(props: PageProps<"/dev/rig">) {
  const q = await props.searchParams;
  const str = (v: string | string[] | undefined, d: string) => (typeof v === "string" ? v : d);
  return (
    <RigViewer
      fpp={q.fpp === "1"}
      orbit={q.orbit === "1"}
      solo={q.solo === "1"}
      move={Number(str(q.move, "0"))}
      weapon={str(q.weapon, "ar") as WeaponId}
      pitch={Number(str(q.pitch, "0"))}
      speed={Number(str(q.speed, "0"))}
      reload={Number(str(q.reload, "-1"))}
      ads={Number(str(q.ads, "0"))}
      shot={Number(str(q.shot, "-1"))}
      draw={Number(str(q.draw, "-1"))}
      fov={Number(str(q.fov, "78"))}
      cam={str(q.cam, "3.2,1.7,-3.6").split(",").map(Number) as [number, number, number]}
      target={typeof q.target === "string" ? q.target.split(",").map(Number) as [number, number, number] : undefined}
    />
  );
}
