#!/data/data/com.termux/files/usr/bin/bash

# Auto-update NEXT_PUBLIC_APP_URL from Cloudflare Tunnel logs
# Run this after PM2 starts cloudflared

set -e

FOTOHAVEN_DIR="$HOME/fotohaven"
ENV_FILE="$FOTOHAVEN_DIR/.env.local"
MAX_RETRIES=30  # Wait up to 30 seconds for tunnel URL
RETRY_DELAY=1   # Check every 1 second

echo "Waiting for Cloudflare Tunnel URL..."

for i in $(seq 1 $MAX_RETRIES); do
    # Extract URL from PM2 logs
    TUNNEL_URL=$(pm2 logs cloudflared --nostream --lines 100 2>/dev/null | \
                 grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | \
                 head -n 1)
    
    if [ -n "$TUNNEL_URL" ]; then
        echo "Found Cloudflare URL: $TUNNEL_URL"
        
        # Check if .env.local exists
        if [ ! -f "$ENV_FILE" ]; then
            echo "Error: .env.local not found at $ENV_FILE"
            exit 1
        fi
        
        # Update NEXT_PUBLIC_APP_URL in .env.local
        if grep -q "^NEXT_PUBLIC_APP_URL=" "$ENV_FILE"; then
            # Replace existing line
            sed -i "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=$TUNNEL_URL|" "$ENV_FILE"
            echo "Updated NEXT_PUBLIC_APP_URL in .env.local"
        else
            # Add new line if it doesn't exist
            echo "NEXT_PUBLIC_APP_URL=$TUNNEL_URL" >> "$ENV_FILE"
            echo "Added NEXT_PUBLIC_APP_URL to .env.local"
        fi
        
        # Restart fotohaven to pick up new URL
        echo "Restarting FotoHaven..."
        pm2 restart fotohaven
        
        echo "✓ Tunnel URL updated successfully!"
        exit 0
    fi
    
    echo "Attempt $i/$MAX_RETRIES: Waiting for tunnel URL..."
    sleep $RETRY_DELAY
done

echo "Error: Cloudflare Tunnel URL not found after $MAX_RETRIES seconds"
echo "Check PM2 logs: pm2 logs cloudflared"
exit 1