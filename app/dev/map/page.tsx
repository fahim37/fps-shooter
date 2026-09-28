import MapViewer from "./MapViewerLoader";
import type { Quality } from "@/game/client/settings";

// Dev tool: orbit around the generated village. /dev/map?cam=40,30,40&target=0,0,0&quality=high
export default async function MapPage(props: PageProps<"/dev/map">) {
  const q = await props.searchParams;
  const str = (v: string | string[] | undefined, d: string) => (typeof v === "string" ? v : d);
  const vec = (s: string) => s.split(",").map(Number) as [number, number, number];
  return (
    <MapViewer
      cam={vec(str(q.cam, "45,35,55"))}
      target={vec(str(q.target, "0,0,0"))}
      quality={typeof q.quality === "string" ? (q.quality as Quality) : undefined}
    />
  );
}
