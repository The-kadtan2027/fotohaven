// ecosystem.config.js
// PM2 process manager config — run with: pm2 start ecosystem.config.js
// Docs: https://pm2.keymetrics.io/docs/usage/application-declaration/

module.exports = {
  apps: [
    {
      name: 'cloudflared',
      script: process.env.PREFIX + '/bin/cloudflared',
      args: 'tunnel --protocol http2 --url http://localhost:3000',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: "fotohaven",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: process.env.APP_DIR || "/data/data/com.termux/files/home/fotohaven",

      // Restart policy
      autorestart: true,
      watch: false,           // don't watch files in production
      max_memory_restart: "1024M",  // restart if it exceeds 300MB (safe for most phones)
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
  ],
};