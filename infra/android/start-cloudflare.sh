#!/data/data/com.termux/files/usr/bin/bash

# start-cloudflare.sh
# Intercepts Cloudflare Tunnel output, extracts URL, updates .env.local, restarts app

set -e  # Exit on error

# Configuration
ENV_FILE="$HOME/fotohaven/.env.local"
CLOUDFLARED_BIN="${PREFIX:-/data/data/com.termux/files/usr}/bin/cloudflared"
CLOUDFLARED_ARGS="tunnel --url http://localhost:3000 --protocol http2 --proxy-connect-timeout 60s --proxy-read-timeout 300s"

# Verify cloudflared exists
if [ ! -x "$CLOUDFLARED_BIN" ]; then
  if command -v cloudflared &>/dev/null; then
    CLOUDFLARED_BIN="cloudflared"
  else
    echo "[FotoHaven-Sys] ERROR: cloudflared not found"
    exit 1
  fi
fi

# Verify .env.local exists
if [ ! -f "$ENV_FILE" ]; then
  echo "[FotoHaven-Sys] WARNING: $ENV_FILE not found. Creating it..."
  touch "$ENV_FILE"
fi

# Track if URL has been updated
URL_UPDATED=0

echo "[FotoHaven-Sys] Starting Cloudflare Tunnel..."

# Run cloudflared and intercept output
"$CLOUDFLARED_BIN" $CLOUDFLARED_ARGS 2>&1 | while IFS= read -r line; do
  
  # Forward all output to PM2 logs
  echo "$line"
  
  # Skip URL extraction if already updated
  if [ $URL_UPDATED -eq 1 ]; then
    continue
  fi

  # Extract tunnel URL (case-insensitive for robustness)
  URL=$(echo "$line" | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | head -n 1)

  if [ -n "$URL" ]; then
    echo "[FotoHaven-Sys] Detected Tunnel URL: $URL"

    # Read current URL from .env.local
    CURRENT_URL=""
    if grep -q "NEXT_PUBLIC_APP_URL=" "$ENV_FILE" 2>/dev/null; then
      CURRENT_URL=$(grep "^NEXT_PUBLIC_APP_URL=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '"' | tr -d "'")
    fi

    # Check if URL actually changed
    if [ "$CURRENT_URL" = "$URL" ]; then
      echo "[FotoHaven-Sys] URL unchanged ($URL). Skipping restart."
      URL_UPDATED=1
      continue
    fi

    # Update .env.local
    if grep -q "^NEXT_PUBLIC_APP_URL=" "$ENV_FILE"; then
      # Replace existing line
      sed -i "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=\"$URL\"|" "$ENV_FILE"
      echo "[FotoHaven-Sys] Updated NEXT_PUBLIC_APP_URL in $ENV_FILE"
    else
      # Append new line
      echo "" >> "$ENV_FILE"
      echo "NEXT_PUBLIC_APP_URL=\"$URL\"" >> "$ENV_FILE"
      echo "[FotoHaven-Sys] Added NEXT_PUBLIC_APP_URL to $ENV_FILE"
    fi

    # Restart FotoHaven to pick up new URL
    echo "[FotoHaven-Sys] Restarting FotoHaven..."
    if pm2 restart fotohaven --update-env; then
      echo "[FotoHaven-Sys] ✓ FotoHaven restarted successfully"
    else
      echo "[FotoHaven-Sys] ✗ Failed to restart FotoHaven"
    fi

    # Mark as updated to prevent duplicate restarts
    URL_UPDATED=1
  fi
done