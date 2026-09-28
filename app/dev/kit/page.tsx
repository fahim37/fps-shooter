import KitViewer from "./KitViewerLoader";
import type { KitName } from "@/game/shared/map/types";

// Dev tool: lays out every piece of a kit on a grid. /dev/kit?kit=village&filter=wall&cam=10,20,30
export default async function KitPage(props: PageProps<"/dev/kit">) {
  const q = await props.searchParams;
  const str = (v: string | string[] | undefined, d: string) => (typeof v === "string" ? v : d);
  const cam = str(q.cam, "20,40,60").split(",").map(Number) as [number, number, number];
  const target = str(q.target, "20,0,20").split(",").map(Number) as [number, number, number];
  return (
    <KitViewer
      kit={str(q.kit, "village") as KitName}
      filter={str(q.filter, "")}
      spacing={Number(str(q.spacing, "7"))}
      cam={cam}
      target={target}
    />
  );
}
