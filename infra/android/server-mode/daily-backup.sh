#!/data/data/com.termux/files/usr/bin/bash
# Daily SQLite backup + weekly uploads manifest for the FotoHaven phone.
# Retention: 7 daily DB copies, 4 weekly manifests. Never touches live uploads.
set -u

export PATH="$PREFIX/bin:/system/bin:/system/xbin:$PATH"

APP_DIR=${BACKUP_APP_DIR:-$HOME/fotohaven}
BACKUP_DIR=${BACKUP_DIR:-$HOME/fotohaven-backups/daily}
UPLOAD_DIR=${UPLOAD_DIR:-$HOME/storage/shared/fotohaven-uploads}
LOG=${BACKUP_LOG:-$HOME/daily-backup.log}
HOUR=${BACKUP_HOUR:-3}
MINUTE=${BACKUP_MINUTE:-15}

mkdir -p "$BACKUP_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
  if [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

run_backup() {
  local ts db manifest
  ts=$(date +%Y%m%d-%H%M%S)
  db="$BACKUP_DIR/local-$ts.db"
  log "backup start $ts"

  if ! sqlite3 "$APP_DIR/local.db" ".backup '$db'"; then
    log "DB_BACKUP_FAILED $db"
    return 1
  fi

  local integrity
  integrity=$(sqlite3 "$db" "PRAGMA integrity_check;" 2>/dev/null | head -1)
  if [ "$integrity" != "ok" ]; then
    log "DB_BACKUP_BAD integrity='$integrity'"
    return 1
  fi
  log "DB_BACKUP_OK $db ($(du -h "$db" | cut -f1))"

  # Weekly uploads manifest (Sunday), so a lost file can be identified.
  if [ "$(date +%u)" = "7" ] && [ -d "$UPLOAD_DIR" ]; then
    manifest="$BACKUP_DIR/uploads-$ts.tsv.gz"
    if find "$UPLOAD_DIR" -type f -printf '%s\t%p\n' 2>/dev/null | gzip > "$manifest"; then
      log "UPLOADS_MANIFEST_OK $manifest ($(gzip -l "$manifest" | awk 'NR==2{print $1}') bytes compressed)"
    else
      log "UPLOADS_MANIFEST_FAILED"
    fi
    find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tsv.gz' -mtime +30 -delete 2>/dev/null || true
  fi

  # Retention: keep 7 days of DB copies.
  find "$BACKUP_DIR" -maxdepth 1 -name 'local-*.db' -mtime +7 -delete 2>/dev/null || true
  log "backup done"
}

if [ "${1:-}" = "--once" ]; then
  run_backup
  exit $?
fi

while :; do
  now_h=$(date +%H)
  now_m=$(date +%M)
  if [ "$now_h" = "$(printf '%02d' "$HOUR")" ] && [ "$now_m" = "$(printf '%02d' "$MINUTE")" ]; then
    run_backup || true
    sleep 61
  else
    sleep 30
  fi
done
