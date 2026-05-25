// ecosystem.config.js
// PM2 process manager config — run with: pm2 start ecosystem.config.js
// Docs: https://pm2.keymetrics.io/docs/usage/application-declaration/

module.exports = {
  apps: [
    {
      name: 'cloudflared',
      script: 'cloudflared',
      args: 'tunnel --config infra/android/cloudflared-config.yml run',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: "fotohaven",
      script: "node_modules/.bin/next",
      args: "start",
      nice: -10,  // Higher priority (range: -20 to 19)
      cwd: process.env.APP_DIR || "/data/data/com.termux/files/home/fotohaven",

      // Restart policy
      autorestart: true,
      watch: false,           // don't watch files in production
      max_memory_restart: "1024M",  // restart if it exceeds 300MB (safe for most phones)
      node_args: '--max-old-space-size=768 --expose-gc --optimize-for-size',  // Set heap to 768MB (was default ~512MB)
      restart_delay: 5000,         // wait 5s before restarting on crash

      // Environment
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // Logging — stored in ~/.pm2/logs/
      out_file: "~/.pm2/logs/fotohaven-out.log",
      error_file: "~/.pm2/logs/fotohaven-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      // Android specific: single instance (phone CPUs are single/dual core effectively)
      instances: 1,
      exec_mode: "fork",
    },
    {
      name: "face-service",
      script: process.platform === "win32" ? "python" : "python3",
      args: "-m uvicorn main:app --host 127.0.0.1 --port 5001 --workers 1",
      interpreter: "none",
      cwd: `${process.env.APP_DIR || "/data/data/com.termux/files/home/fotohaven"}/face-service`,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      watch: false,
      env: {
        DB_PATH: "../local.db",
        LOCAL_UPLOAD_PATH: "/data/data/com.termux/files/home/storage/shared/fotohaven-uploads",
        PYTHONUNBUFFERED: "1",
      },
      out_file: "~/.pm2/logs/face-service-out.log",
      error_file: "~/.pm2/logs/face-service-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
  ],
};
