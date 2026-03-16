#!/data/data/com.termux/files/usr/bin/bash
# infra/android/backup.sh
#
# Backs up the SQLite database and (optionally) uploaded photos.
# Run manually or add to cron for automatic daily backups.
#
# Cron — daily at 2am (add via: crontab -e):
#   0 2 * * * bash ~/fotohaven/infra/android/backup.sh >> ~/.pm2/logs/backup.log 2>&1
#
# What gets backed up:
#   1. SQLite database (always) → ~/storage/shared/fotohaven-backups/
#   2. Uploaded photos (if LOCAL_UPLOAD_PATH is set) — same destination
#   3. .env.local (encrypted with openssl if BACKUP_PASSWORD is set)

set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

# ── Config ────────────────────────────────────────────────────────────────────
APP_DIR="$HOME/fotohaven"
DB_PATH="$APP_DIR/prisma/dev.db"
BACKUP_DIR="${BACKUP_DIR:-$HOME/storage/shared/fotohaven-backups}"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_NAME="fotohaven_backup_$TIMESTAMP"

# Load env for any custom paths
[ -f "$APP_DIR/.env.local" ] && source "$APP_DIR/.env.local"

echo -e "${BOLD}── FotoHaven Backup $TIMESTAMP ──${RESET}"

# ── Create backup destination ─────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
DEST="$BACKUP_DIR/$BACKUP_NAME"
mkdir -p "$DEST"

# ── 1. Backup SQLite DB ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Backing up database...${RESET}"
if [ -f "$DB_PATH" ]; then
  # Use SQLite's .backup command for a consistent snapshot (safe while app runs)
  sqlite3 "$DB_PATH" ".backup '$DEST/dev.db'"
  DB_SIZE=$(du -sh "$DEST/dev.db" | cut -f1)
  echo -e "  ${GREEN}✓ Database backed up (${DB_SIZE})${RESET}"
else
  echo -e "  ${YELLOW}⚠ No database found at $DB_PATH${RESET}"
fi

# ── 2. Backup .env.local (config) ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}Backing up config...${RESET}"
if [ -f "$APP_DIR/.env.local" ]; then
  if [ -n "$BACKUP_PASSWORD" ]; then
    # Encrypt with openssl if password is set
    openssl enc -aes-256-cbc -salt -pbkdf2 \
      -in "$APP_DIR/.env.local" \
      -out "$DEST/env.local.enc" \
      -pass pass:"$BACKUP_PASSWORD"
    echo -e "  ${GREEN}✓ Config backed up (encrypted)${RESET}"
  else
    cp "$APP_DIR/.env.local" "$DEST/env.local.txt"
    echo -e "  ${YELLOW}⚠ Config backed up (unencrypted — set BACKUP_PASSWORD to encrypt)${RESET}"
  fi
fi

# ── 3. Backup uploaded photos (if using local storage) ────────────────────────
echo ""
echo -e "${BOLD}Backing up photos...${RESET}"
LOCAL_PHOTOS="${LOCAL_UPLOAD_PATH:-}"
if [ -n "$LOCAL_PHOTOS" ] && [ -d "$LOCAL_PHOTOS" ]; then
  PHOTO_COUNT=$(find "$LOCAL_PHOTOS" -type f | wc -l)
  PHOTO_SIZE=$(du -sh "$LOCAL_PHOTOS" | cut -f1)
  echo "  Found $PHOTO_COUNT photos ($PHOTO_SIZE) — copying..."
  cp -r "$LOCAL_PHOTOS" "$DEST/photos"
  echo -e "  ${GREEN}✓ Photos backed up${RESET}"
else
  echo -e "  Skipped (using Cloudflare R2 — photos already in cloud)"
fi

# ── 4. Write a manifest ───────────────────────────────────────────────────────
cat > "$DEST/manifest.txt" << MANIFEST
FotoHaven Backup
================
Timestamp:  $TIMESTAMP
Device:     $(uname -n)
App path:   $APP_DIR
DB size:    $(du -sh "$DEST/dev.db" 2>/dev/null | cut -f1 || echo "n/a")
MANIFEST

# ── 5. Rotate old backups (keep last 7) ───────────────────────────────────────
echo ""
echo -e "${BOLD}Rotating old backups (keeping last 7)...${RESET}"
BACKUP_COUNT=$(ls -1d "$BACKUP_DIR"/fotohaven_backup_* 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 7 ]; then
  ls -1dt "$BACKUP_DIR"/fotohaven_backup_* | tail -n +8 | xargs rm -rf
  echo -e "  ${GREEN}✓ Cleaned up old backups${RESET}"
else
  echo -e "  ${GREEN}✓ $BACKUP_COUNT backups on disk (under limit)${RESET}"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
FINAL_SIZE=$(du -sh "$DEST" | cut -f1)
echo -e "${GREEN}${BOLD}Backup complete → $DEST (${FINAL_SIZE})${RESET}"
echo ""
echo "Tip: Open the Files app on your phone → Internal Storage → fotohaven-backups"
echo "     to copy backups to Google Drive or an SD card."
