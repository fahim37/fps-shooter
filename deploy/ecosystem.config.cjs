// eslint-disable-next-line @typescript-eslint/no-require-imports -- PM2 loads this as CommonJS.
const fs = require("node:fs");
const voiceConfigPath = process.env.HOLLOWMERE_VOICE_CONFIG || "/etc/hollowmere/voice.json";
const voiceConfig = fs.existsSync(voiceConfigPath) ? JSON.parse(fs.readFileSync(voiceConfigPath, "utf8")) : {};
// Admin dashboard login and analytics database: a root-only JSON file, never committed.
const adminConfigPath = process.env.HOLLOWMERE_ADMIN_CONFIG || "/etc/hollowmere/admin.json";
let adminConfig = {};
try {
  if (fs.existsSync(adminConfigPath)) adminConfig = JSON.parse(fs.readFileSync(adminConfigPath, "utf8"));
} catch (e) {
  console.warn(`[hollowmere] cannot read ${adminConfigPath} (${e.message}); admin dashboard stays disabled`);
}
const ADMIN_KEYS = ["ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "ADMIN_PASSWORD", "ADMIN_SECRET", "MONGODB_URI", "ANALYTICS_RETENTION_DAYS", "ANALYTICS_DISABLED"];
const adminEnv = Object.fromEntries(ADMIN_KEYS.filter((k) => adminConfig[k] !== undefined && adminConfig[k] !== "").map((k) => [k, String(adminConfig[k])]));

module.exports = {
  apps: [
    {
      name: "hollowmere-web",
      cwd: "/var/www/fps-shooter",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3006",
      env: { NODE_ENV: "production", NEXT_PUBLIC_BASE_PATH: "/fps" },
      max_memory_restart: "600M",
    },
    {
      name: "hollowmere-game",
      cwd: "/var/www/fps-shooter",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "server/index.ts",
      env: {
        NODE_ENV: "production", HOST: "127.0.0.1", PORT: "2567",
        ...(voiceConfig.VOICE_TURN_URLS && voiceConfig.VOICE_TURN_SECRET ? {
          VOICE_TURN_URLS: voiceConfig.VOICE_TURN_URLS, VOICE_TURN_SECRET: voiceConfig.VOICE_TURN_SECRET,
        } : {}),
        MONGODB_URI: "mongodb://127.0.0.1:27017/hollowmere",
        ...adminEnv,
      },
      // The offline IP-location database (geoip-lite) keeps ~120 MB in memory once loaded.
      max_memory_restart: "1000M",
      // Time to flush finished sessions to MongoDB on restart.
      kill_timeout: 5000,
    },
  ],
};
