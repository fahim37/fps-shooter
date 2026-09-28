import { Client, type Room } from "@colyseus/sdk";
import { gameServerUrl, gameServerHttp } from "./endpoint";
import { ROOM_NAME, type GameMode } from "../../shared/constants";
import type { JoinOptions } from "../../shared/messages";
import type { MatchState } from "../../shared/schema";

export type GameRoom = Room<unknown, MatchState>;

export interface PublicRoom {
  code: string;
  name: string;
  mode: GameMode;
  humans: number;
  bots: number;
  max: number;
  locked: boolean;
}

let client: Client | null = null;
let current: GameRoom | null = null;

function getClient() {
  return (client ??= new Client(gameServerUrl()));
}

/** The room the lobby just joined, handed to the game page (same SPA, so module state survives). */
export function takeCurrentRoom(code: string): GameRoom | null {
  if (current && current.roomId.toUpperCase() === code.toUpperCase()) return current;
  return null;
}

export async function leaveCurrentRoom() {
  const r = current;
  current = null;
  if (r) {
    try {
      await r.leave(true);
    } catch {
      /* already closed */
    }
  }
}

async function adopt(p: Promise<GameRoom>) {
  await leaveCurrentRoom();
  const room = await p;
  room.reconnection.enabled = true;
  current = room;
  return room;
}

export function quickPlay(opts: JoinOptions) {
  return adopt(getClient().joinOrCreate(ROOM_NAME, opts) as Promise<GameRoom>);
}

export function createRoom(opts: JoinOptions) {
  return adopt(getClient().create(ROOM_NAME, opts) as Promise<GameRoom>);
}

export function joinByCode(code: string, opts: JoinOptions) {
  return adopt(getClient().joinById(code.trim().toUpperCase(), opts) as Promise<GameRoom>);
}

export async function listRooms(): Promise<PublicRoom[]> {
  const res = await fetch(`${gameServerHttp()}/rooms`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function serverOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${gameServerHttp()}/health`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Human-readable reason for a failed join. */
export function joinErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not found|invalid|expired/i.test(msg)) return "That room doesn't exist anymore. Check the code or start a new one.";
  if (/locked|full/i.test(msg)) return "That room is full.";
  if (/fetch|network|ECONNREFUSED|Failed/i.test(msg)) return "Can't reach the game server. Is it running? (npm run dev starts it)";
  return msg;
}
