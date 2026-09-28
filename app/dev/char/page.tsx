import CharViewer from "./CharViewerLoader";
import type { ClipName } from "@/game/client/assets/characters";

// Dev tool: characters with a clip. /dev/char?clip=aimNeutral&cam=0,1.6,3&axes=1
export default async function CharPage(props: PageProps<"/dev/char">) {
  const q = await props.searchParams;
  const str = (v: string | string[] | undefined, d: string) => (typeof v === "string" ? v : d);
  const vec = (s: string) => s.split(",").map(Number) as [number, number, number];
  return (
    <CharViewer
      clip={str(q.clip, "idle") as ClipName}
      cam={vec(str(q.cam, "0,1.4,3.2"))}
      target={vec(str(q.target, "0,1,0"))}
      axes={q.axes === "1"}
    />
  );
}
