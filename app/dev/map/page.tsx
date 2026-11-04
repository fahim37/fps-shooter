import MapViewer from "./MapViewerLoader";
import type { Quality } from "@/game/client/settings";

// Dev tool: orbit around a generated map. /dev/map?map=downtown&cam=40,30,40&target=0,0,0&quality=high
// A plan view sliced at a height: /dev/map?map=desert&plan=0,0,40&clip=4.5 (center x, z and the visible width)
export default async function MapPage(props: PageProps<"/dev/map">) {
  const q = await props.searchParams;
  const str = (v: string | string[] | undefined, d: string) => (typeof v === "string" ? v : d);
  const vec = (s: string) => s.split(",").map(Number) as [number, number, number];
  return (
    <MapViewer
      map={str(q.map, "village")}
      cam={vec(str(q.cam, "45,35,55"))}
      target={vec(str(q.target, "0,0,0"))}
      quality={typeof q.quality === "string" ? (q.quality as Quality) : undefined}
      plan={typeof q.plan === "string" ? vec(q.plan) : undefined}
      clip={typeof q.clip === "string" ? Number(q.clip) : undefined}
    />
  );
}
