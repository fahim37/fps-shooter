import { defineServer, defineRoom, matchMaker } from "colyseus";
import { MatchRoom } from "./MatchRoom";
import { initWorldData } from "./world";
import { ROOM_NAME } from "../game/shared/constants";
import type { RoomMeta } from "../game/shared/messages";
import type { Application } from "express";

const port = Number(process.env.PORT || 2567);

const server = defineServer({
  rooms: {
    // Quick play joins the fullest public room first.
    [ROOM_NAME]: defineRoom(MatchRoom).filterBy(["mode"]).sortBy({ clients: -1 }),
  },
  greet: false,
  beforeListen: () => initWorldData(),
  express: (app: Application) => {
    app.use((_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      next();
    });
    app.get("/health", (_req, res) => {
      res.json({ ok: true });
    });
    // Public rooms for the lobby browser.
    app.get("/rooms", async (_req, res) => {
      const rooms = await matchMaker.query({ name: ROOM_NAME, private: false });
      res.json(
        rooms.map((r) => {
          const meta = (r.metadata ?? {}) as Partial<RoomMeta>;
          return {
            code: r.roomId,
            name: meta.roomName ?? "Match",
            mode: meta.mode ?? "tdm",
            humans: meta.humans ?? r.clients,
            bots: meta.bots ?? 0,
            max: r.maxClients,
            locked: r.locked,
          };
        }),
      );
    });
  },
});

// COLYSEUS_LATENCY=150 simulates a 150 ms round trip for testing netcode.
if (process.env.SIM_LATENCY_MS) process.env.COLYSEUS_LATENCY = process.env.SIM_LATENCY_MS;

server.listen(port, process.env.HOST || "0.0.0.0").then(() => {
  console.log(`[server] Hollowmere game server on ws://localhost:${port}`);
});
