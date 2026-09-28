import RigViewer from "./RigViewerLoader";
import type { WeaponId } from "@/game/shared/weapons";

// Dev tool: weapon-holding rigs. /dev/rig?pitch=0&speed=0&reload=-1  or  /dev/rig?fpp=1&weapon=ar&ads=0
export default async function RigPage(props: PageProps<"/dev/rig">) {
  const q = await props.searchParams;
  const str = (v: string | string[] | undefined, d: string) => (typeof v === "string" ? v : d);
  return (
    <RigViewer
      fpp={q.fpp === "1"}
      weapon={str(q.weapon, "ar") as WeaponId}
      pitch={Number(str(q.pitch, "0"))}
      speed={Number(str(q.speed, "0"))}
      reload={Number(str(q.reload, "-1"))}
      ads={Number(str(q.ads, "0"))}
      cam={str(q.cam, "3.2,1.7,-3.6").split(",").map(Number) as [number, number, number]}
    />
  );
}
