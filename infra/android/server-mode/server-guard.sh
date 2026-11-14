#!/data/data/com.termux/files/usr/bin/bash
# FotoHaven server guard: checks the local app, tunnel process and face service.
# Runs under runit (or PM2); restarts only after repeated failures.
set -u

export PATH="$PREFIX/bin:/system/bin:/system/xbin:$PATH"

APP_URL=${GUARD_APP_URL:-http://127.0.0.1:3000/}
FACE_URL=${GUARD_FACE_URL:-http://127.0.0.1:5080/health}
INTERVAL=${GUARD_INTERVAL:-60}
LOG=${GUARD_LOG:-$HOME/server-guard.log}

app_fail=0
tunnel_fail=0
face_fail=0
low_disk_logged=0
hot_logged=0

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
  if [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

app_ok() {
  curl -fsS -o /dev/null --max-time 8 "$APP_URL" 2>/dev/null
}

face_ok() {
  curl -fsS -o /dev/null --max-time 5 "$FACE_URL" 2>/dev/null
}

pm2_pid() {
  pm2 pid "$1" 2>/dev/null | tr -d '\r\n' | awk '{print $1}'
}

pm2_running() {
  pid=$(pm2_pid "$1")
  [ -n "$pid" ] && [ "$pid" != "0" ]
}

while :; do
  if app_ok; then
    app_fail=0
  else
    app_fail=$((app_fail + 1))
    log "app probe failed (${app_fail}/3)"
  fi
  if (( app_fail >= 3 )); then
    log "restarting fotohaven after 3 failed probes"
    pm2 restart fotohaven --update-env >/dev/null 2>&1 || pm2 resurrect >/dev/null 2>&1 || true
    app_fail=0
    sleep 10
  fi

  if pm2_running cloudflared; then
    tunnel_fail=0
  else
    tunnel_fail=$((tunnel_fail + 1))
    log "cloudflared missing (${tunnel_fail}/2)"
    if (( tunnel_fail >= 2 )); then
      pm2 restart cloudflared --update-env >/dev/null 2>&1 || pm2 resurrect >/dev/null 2>&1 || true
      tunnel_fail=0
    fi
  fi

  if face_ok; then
    face_fail=0
  else
    face_fail=$((face_fail + 1))
    log "face service probe failed (${face_fail}/2)"
    if (( face_fail >= 2 )); then
      pm2 restart native-face-service >/dev/null 2>&1 || pm2 resurrect >/dev/null 2>&1 || true
      face_fail=0
    fi
  fi

  free_kb=$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2 {print $4}')
  if [[ ${free_kb:-} =~ ^[0-9]+$ ]] && (( free_kb < 1048576 )); then
    if (( low_disk_logged == 0 )); then
      log "LOW_DISK free=${free_kb}KB"
      low_disk_logged=1
    fi
  else
    low_disk_logged=0
  fi

  temp=$(su -c "cat /sys/class/power_supply/battery/temp" 2>/dev/null | tr -d '\r\n')
  if [[ ${temp:-} =~ ^[0-9]+$ ]] && (( temp >= 450 )); then
    if (( hot_logged == 0 )); then
      log "BATTERY_HOT temp=${temp}"
      hot_logged=1
    fi
  else
    hot_logged=0
  fi

  sleep "$INTERVAL"
done
