#!/data/data/com.termux/files/usr/bin/bash
# One-screen status for the FotoHaven phone server.
export PATH="/data/data/com.termux/files/usr/bin:/system/bin:/system/xbin:$PATH"
export SVDIR="$PREFIX/var/service"

echo "== PM2 =="
pm2 list 2>/dev/null | sed -n '1,14p'

echo
echo "== RUNIT =="
sv status charge-limit server-guard daily-backup 2>/dev/null

echo
echo "== BATTERY =="
su -c 'printf "capacity=%s%% enabled=%s slow=%s temp=%s status=%s\n" \
  "$(cat /sys/class/power_supply/battery/capacity)" \
  "$(cat /sys/class/power_supply/battery/battery_charging_enabled)" \
  "$(cat /sys/class/power_supply/battery/slowly_charging)" \
  "$(cat /sys/class/power_supply/battery/temp)" \
  "$(cat /sys/class/power_supply/battery/status)"' 2>/dev/null

echo
echo "== APP =="
curl -s -o /dev/null -w "local=%{http_code} %{time_total}s\n" --max-time 8 http://127.0.0.1:3000/ || echo "local=DOWN"
curl -s -o /dev/null -w "public=%{http_code} %{time_total}s\n" --max-time 15 https://fotohaven.live/ || echo "public=DOWN"

echo
echo "== DISK =="
df -h "$HOME" 2>/dev/null | tail -1

echo
echo "== RECENT CHARGE =="
tail -n 5 "$HOME/charge-limit.log" 2>/dev/null
echo
echo "== RECENT GUARD =="
tail -n 5 "$HOME/server-guard.log" 2>/dev/null
