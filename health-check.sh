#!/data/data/com.termux/files/usr/bin/bash
# infra/android/health-check.sh
#
# Quick health check — run anytime to see the state of your phone server.
# Also useful to add to cron for automatic restart if app goes down.
#
# Usage:
#   bash health-check.sh
#
# Cron (auto-check every 5 minutes — add via: crontab -e):
#   */5 * * * * bash ~/fotohaven/infra/android/health-check.sh >> ~/.pm2/logs/healthcheck.log 2>&1

BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[1;33m"
RESET="\033[0m"

APP_URL="http://localhost:3000"
APP_NAME="fotohaven"

echo -e "${BOLD}── FotoHaven Health Check $(date '+%Y-%m-%d %H:%M:%S') ──${RESET}"

# ── 1. PM2 process status ──────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Process (PM2):${RESET}"
if pm2 list | grep -q "$APP_NAME.*online"; then
  echo -e "  ${GREEN}✓ fotohaven is running${RESET}"
else
  echo -e "  ${RED}✗ fotohaven is NOT running — restarting...${RESET}"
  cd ~/fotohaven && pm2 start ecosystem.config.js
fi

# ── 2. HTTP response check ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}HTTP response:${RESET}"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$APP_URL" 2>/dev/null)
if [ "$HTTP_STATUS" = "200" ]; then
  echo -e "  ${GREEN}✓ HTTP $HTTP_STATUS — app responding${RESET}"
else
  echo -e "  ${RED}✗ HTTP $HTTP_STATUS — app not responding${RESET}"
fi

# ── 3. Cloudflare Tunnel ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Cloudflare Tunnel:${RESET}"
if pgrep -x "cloudflared" > /dev/null; then
  echo -e "  ${GREEN}✓ cloudflared is running${RESET}"
else
  echo -e "  ${YELLOW}⚠ cloudflared is not running${RESET}"
  echo -e "  Start with: cloudflared tunnel --config ~/fotohaven/infra/android/cloudflared-config.yml run &"
fi

# ── 4. Disk space ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Disk space:${RESET}"
df -h /data/data/com.termux/files/home | tail -1 | awk '{
  used=$3; avail=$4; pct=$5;
  print "  Used: " used " | Available: " avail " | " pct " used"
}'

# ── 5. Memory usage ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Memory:${RESET}"
free -h 2>/dev/null | grep Mem | awk '{print "  Total: " $2 " | Used: " $3 " | Free: " $4}' \
  || echo "  (free command not available)"

# ── 6. DB size ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Database:${RESET}"
DB_PATH="$HOME/fotohaven/prisma/dev.db"
if [ -f "$DB_PATH" ]; then
  DB_SIZE=$(du -sh "$DB_PATH" | cut -f1)
  echo -e "  ${GREEN}✓ dev.db exists (${DB_SIZE})${RESET}"
else
  echo -e "  ${RED}✗ dev.db not found${RESET}"
fi

# ── 7. Network ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Network:${RESET}"
if ping -c 1 -W 3 8.8.8.8 > /dev/null 2>&1; then
  echo -e "  ${GREEN}✓ Internet reachable${RESET}"
else
  echo -e "  ${RED}✗ No internet connection${RESET}"
fi

echo ""
echo "──────────────────────────────────────────"
echo "  pm2 logs $APP_NAME    → view live logs"
echo "  pm2 restart $APP_NAME → force restart"
echo "──────────────────────────────────────────"
