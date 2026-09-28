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
      env: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: "2567" },
      max_memory_restart: "800M",
    },
  ],
};
