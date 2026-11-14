#!/data/data/com.termux/files/usr/bin/bash
# FotoHaven battery charge limiter for a 24/7 phone server.
# Stops charging at CHARGE_STOP and resumes at CHARGE_RESUME. Uses slow
# charging whenever it does charge. Safe to run repeatedly.
set -u

BAT=/sys/class/power_supply/battery
STOP=${CHARGE_STOP:-80}
RESUME=${CHARGE_RESUME:-75}
TEMP_STOP=${CHARGE_TEMP_STOP:-420}       # 42.0 C, tenths of a degree
TEMP_RESUME=${CHARGE_TEMP_RESUME:-380}   # 38.0 C
INTERVAL=${CHARGE_INTERVAL:-30}
LOG=${CHARGE_LOG:-$HOME/charge-limit.log}

last_error=""

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
  if [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

read_state() {
  su -c "cat $BAT/capacity; cat $BAT/battery_charging_enabled; cat $BAT/temp; cat $BAT/slowly_charging" 2>/dev/null
}

write_enabled() {
  su -c "echo $1 > $BAT/battery_charging_enabled" 2>/dev/null
}

write_slow() {
  su -c "echo $1 > $BAT/slowly_charging" 2>/dev/null
}

# Prefer gentle charging before the first state check.
write_slow 1 || true

while :; do
  raw=$(read_state) || true
  capacity=$(printf '%s\n' "$raw" | sed -n '1p')
  enabled=$(printf '%s\n' "$raw" | sed -n '2p')
  temp=$(printf '%s\n' "$raw" | sed -n '3p')
  slow=$(printf '%s\n' "$raw" | sed -n '4p')

  if ! [[ $capacity =~ ^[0-9]+$ && $enabled =~ ^[01]$ && $temp =~ ^-?[0-9]+$ && $slow =~ ^[01]$ ]]; then
    message="state unavailable (capacity='$capacity' enabled='$enabled' temp='$temp')"
    if [ "$message" != "$last_error" ]; then
      log "$message"
      last_error=$message
    fi
    sleep "$INTERVAL"
    continue
  fi
  last_error=""

  # Charger re-insertion can reset the SMB property; keep charging gentle.
  if (( enabled == 1 && slow == 0 )); then
    write_slow 1 || true
    slow=1
    log "SLOW_CHARGE capacity=${capacity}"
  fi

  # Thermal guard has priority: never charge a hot battery.
  if (( enabled == 1 && temp >= TEMP_STOP )); then
    if write_enabled 0; then
      log "STOP temp=${temp} capacity=${capacity} (>=${TEMP_STOP})"
    else
      log "STOP_FAILED temp=${temp} capacity=${capacity}"
    fi
    sleep "$INTERVAL"
    continue
  fi

  if (( enabled == 1 && capacity >= STOP )); then
    if write_enabled 0; then
      log "STOP capacity=${capacity} temp=${temp} (>=${STOP})"
    else
      log "STOP_FAILED capacity=${capacity} temp=${temp}"
    fi
  elif (( enabled == 0 && capacity <= RESUME && temp <= TEMP_RESUME )); then
    write_slow 1 || true
    if write_enabled 1; then
      log "RESUME capacity=${capacity} temp=${temp} (<=${RESUME})"
    else
      log "RESUME_FAILED capacity=${capacity} temp=${temp}"
    fi
  fi

  sleep "$INTERVAL"
done
