import { notFound } from "next/navigation";
import Home from "../page";
import { parseRoomCode } from "@/game/client/net/invite";

/** A short invite: /BPH2U opens the game with that room ready to join. */
export default async function RoomInvitePage({ params }: { params: Promise<{ room: string }> }) {
  if (!parseRoomCode((await params).room)) notFound();
  return <Home />;
}
