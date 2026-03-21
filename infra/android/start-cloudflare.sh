#!/data/data/com.termux/files/usr/bin/bash

# start-cloudflare.sh
# Intercepts the native Cloudflare Tunnel output, parses the random trycloudflare.com URL,
# updates the environment variables, and dynamically reloads the server to stay in sync.

ENV_FILE=".env.local"
CLOUDFLARED_BIN="${PREFIX:-/data/data/com.termux/files/usr}/bin/cloudflared"

if [ ! -x "$CLOUDFLARED_BIN" ]; then
  CLOUDFLARED_BIN="cloudflared"
fi

# Run Cloudflared and intercept output line-by-line
"$CLOUDFLARED_BIN" tunnel --url http://localhost:3000 --protocol http2 --proxy-connect-timeout 60s --proxy-read-timeout 300s 2>&1 | while read -r line; do
  
  # Print the normal output to PM2 logs
  echo "$line"

  # Search for the newly provisioned tunnel URL
  URL=$(echo "$line" | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | head -n 1)

  if [ -n "$URL" ]; then
    echo "[FotoHaven-Sys] Intercepted new Tunnel URL: $URL"

    # Compare against current URL to avoid boot-looping the PM2 restart
    if [ -f "$ENV_FILE" ]; then
      CURRENT_URL=$(grep "NEXT_PUBLIC_APP_URL=" "$ENV_FILE" | cut -d'"' -f2)
      if [ "$CURRENT_URL" == "$URL" ]; then
        echo "[FotoHaven-Sys] URL matches existing (.env.local). Skipping restart."
        continue
      fi
    fi

    # Overwrite NEXT_PUBLIC_APP_URL in .env.local safely
    if grep -q "NEXT_PUBLIC_APP_URL=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=\"$URL\"|" "$ENV_FILE"
      echo "[FotoHaven-Sys] Updated .env.local payload"
    else
      echo "" >> "$ENV_FILE"
      echo "NEXT_PUBLIC_APP_URL=\"$URL\"" >> "$ENV_FILE"
      echo "[FotoHaven-Sys] Appended .env.local payload"
    fi

    # Restart the web application gracefully
    echo "[FotoHaven-Sys] Reloading web server to sync URL..."
    pm2 reload fotohaven || pm2 restart fotohaven
  fi
done
