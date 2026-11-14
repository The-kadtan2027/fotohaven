#!/data/data/com.termux/files/usr/bin/sh
# Persistent server-mode tuning for the FotoHaven phone. Safe to run repeatedly.
sleep 5
LOG="$HOME/.pm2/server-tuning.log"
{
  date
  su -c "/system/bin/sysctl -w vm.vfs_cache_pressure=50 vm.min_free_kbytes=65536 net.core.somaxconn=1024 net.ipv4.tcp_keepalive_time=300 net.ipv4.tcp_slow_start_after_idle=0" 2>&1
  for q in /sys/block/dm-*/queue/read_ahead_kb; do
    su -c "echo 2048 > $q" 2>/dev/null || true
  done
  su -c "echo 1 > /sys/class/power_supply/battery/slowly_charging" 2>/dev/null || true
  su -c "/system/bin/settings put global settings_enable_monitor_phantom_procs false" 2>&1
  su -c "/system/bin/device_config put activity_manager max_phantom_processes 2147483647" 2>&1
  su -c "/system/bin/am set-standby-bucket --user 0 com.termux active" 2>&1
  su -c "/system/bin/am set-standby-bucket --user 0 com.termux.boot active" 2>&1
  su -c "/system/bin/cmd appops set com.termux RUN_IN_BACKGROUND allow" 2>&1
  su -c "/system/bin/cmd appops set com.termux RUN_ANY_IN_BACKGROUND allow" 2>&1
  su -c "/system/bin/cmd bluetooth_manager disable" 2>&1
  su -c "/system/bin/settings put global window_animation_scale 0" 2>&1
  su -c "/system/bin/settings put global transition_animation_scale 0" 2>&1
  su -c "/system/bin/settings put global animator_duration_scale 0" 2>&1
  su -c "/system/bin/settings put system screen_off_timeout 30000" 2>&1
  su -c "/system/bin/settings put system accelerometer_rotation 0" 2>&1
  termux-wake-lock 2>&1 || true
  echo "done"
} >> "$LOG" 2>&1
