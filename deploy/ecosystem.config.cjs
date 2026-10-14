// eslint-disable-next-line @typescript-eslint/no-require-imports -- PM2 loads this as CommonJS.
const fs = require("node:fs");
const voiceConfigPath = process.env.HOLLOWMERE_VOICE_CONFIG || "/etc/hollowmere/voice.json";
const voiceConfig = fs.existsSync(voiceConfigPath) ? JSON.parse(fs.readFileSync(voiceConfigPath, "utf8")) : {};

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
      },
      max_memory_restart: "800M",
    },
  ],
};
