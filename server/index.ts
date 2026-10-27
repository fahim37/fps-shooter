import { defineServer, defineRoom, matchMaker } from "colyseus";
import { MatchRoom } from "./MatchRoom";
import { initWorldData } from "./world";
import { ROOM_NAME } from "../game/shared/constants";
import type { RoomMeta } from "../game/shared/messages";
import type { Application } from "express";
import { analytics } from "./analytics/recorder";
import { MongoStore } from "./analytics/mongoStore";
import { adminConfigFromEnv } from "./admin/auth";
import { createAdminApi, mountAdminApi } from "./admin/http";

const port = Number(process.env.PORT || 2567);

// Player analytics go to MongoDB without ever blocking the game; ANALYTICS_DISABLED=1 turns recording off.
const retentionDays = Number(process.env.ANALYTICS_RETENTION_DAYS ?? 180);
const store = process.env.ANALYTICS_DISABLED === "1" ? null
  : new MongoStore(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/hollowmere", Number.isFinite(retentionDays) ? retentionDays : 180);
analytics.start(store);
const adminConfig = adminConfigFromEnv();
if (!adminConfig.enabled) console.log("[admin] dashboard API disabled (set ADMIN_USERNAME and ADMIN_PASSWORD_HASH to enable)");

const server = defineServer({
  rooms: {
    // Quick play joins the fullest public room on the chosen mode and map first.
    [ROOM_NAME]: defineRoom(MatchRoom).filterBy(["mode", "queue", "map"]).sortBy({ clients: -1 }),
  },
  greet: false,
  beforeListen: () => initWorldData(),
  express: (app: Application) => {
    app.use((_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      next();
    });
    // Admin dashboard API (cookie auth; same-origin under /fps/server in production).
    mountAdminApi(app, createAdminApi({
      config: adminConfig,
      store: () => store,
      storage: () => analytics.queue.status,
      live: () => analytics.live(),
    }), adminConfig);
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
            map: meta.map ?? "village",
            humans: meta.humans ?? r.clients,
            bots: meta.bots ?? 0,
            botFill: meta.botFill ?? 0,
            max: r.maxClients,
            locked: r.locked,
            format: meta.format ?? "custom",
            phase: meta.phase ?? "live",
          };
        }),
      );
    });
  },
});

// COLYSEUS_LATENCY=150 simulates a 150 ms round trip for testing netcode.
if (process.env.SIM_LATENCY_MS) process.env.COLYSEUS_LATENCY = process.env.SIM_LATENCY_MS;

server.onShutdown(() => analytics.stop());

server.listen(port, process.env.HOST || "0.0.0.0").then(() => {
  console.log(`[server] Hollowmere game server on ws://localhost:${port}`);
});
