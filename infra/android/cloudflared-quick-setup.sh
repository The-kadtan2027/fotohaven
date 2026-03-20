#!/data/data/com.termux/files/usr/bin/bash
# infra/android/cloudflared-quick-setup.sh
#
# Sets up a Cloudflare Quick Tunnel (No Login) to run from bare Termux.
# It proxies traffic to the FotoHaven app running inside Ubuntu proot.
#
# No account required. Generates a random trycloudflare.com URL on every start.
# Note: Since we use relative URLs in the storage adapter, the app works perfectly
# even though the URL changes every time!

set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
RESET="\033[0m"

step() { echo -e "\n${BOLD}${CYAN}▶ $1${RESET}"; }
ok()   { echo -e "${GREEN}✓ $1${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $1${RESET}"; }

TERMUX_HOME="/data/data/com.termux/files/home"
PROJECT_DIR="$TERMUX_HOME/fotohaven"

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║   FotoHaven — Cloudflare Quick Tunnel Setup          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${RESET}"

# ── Step 1: Install cloudflared natively in Termux ────────────────────────────
step "Checking for cloudflared natively in Termux"
if ! command -v cloudflared >/dev/null 2>&1; then
  warn "Installing cloudflared utility from Termux repos..."
  pkg install -y cloudflared
  ok "Installed cloudflared"
else
  ok "cloudflared is already installed"
fi

# ── Step 2: Create a wrapper script to capture the changing URL ───────────────
step "Creating Quick Tunnel Runner Script"
RUNNER_SCRIPT="$PROJECT_DIR/start-cloudflare-tunnel.sh"
URL_LOG="$PROJECT_DIR/cloudflare-url.txt"

cat > "$RUNNER_SCRIPT" << EOF
#!/data/data/com.termux/files/usr/bin/bash

# Kill any existing cloudflared tunnels
pkill -f "cloudflared tunnel" || true

echo "Starting Cloudflare Quick Tunnel..."
echo "Waiting for URL to be generated..."

# Start it in background and pipe standard error to grep to find the URL
# We log the raw output to a hidden file and just the URL to a clean text file
cloudflared tunnel --url http://localhost:3000 > .cloudflared.log 2>&1 &

# Wait for URL to appear in logs (cloudflared takes 2-5 seconds to negotiate)
for i in {1..15}; do
  sleep 1
  URL=\$(grep -o "https://[-a-zA-Z0-9]*\.trycloudflare\.com" .cloudflared.log | head -n 1)
  if [ -n "\$URL" ]; then
    echo "\$URL" > "$URL_LOG"
    echo -e "\n\033[1;32m✓ Tunnel Active!\033[0m"
    echo -e "\033[1mYour public URL is:\033[0m \033[1;36m\$URL\033[0m"
    echo -e "\n(This URL is also saved to ~/fotohaven/cloudflare-url.txt)"
    exit 0
  fi
done

echo -e "\n\033[0;31m✗ Could not find the URL. Check .cloudflared.log for errors.\033[0m"
EOF

chmod +x "$RUNNER_SCRIPT"
ok "Created $RUNNER_SCRIPT"

# ── Step 3: Update Boot Script ────────────────────────────────────────────────
step "Configuring Boot Script for Cloudflare"
BOOT_SCRIPT="$TERMUX_HOME/.termux/boot/start-fotohaven-cloudflare.sh"
mkdir -p "$(dirname "$BOOT_SCRIPT")"

cat > "$BOOT_SCRIPT" << 'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
# Auto-start: FotoHaven (Ubuntu Proot) + Cloudflare Quick Tunnel
# Requires Termux:Boot app

sleep 15

# 1. Start PM2 inside Ubuntu proot (with explicit bind mount for Android storage)
proot-distro login ubuntu --shared-tmp --bind /storage/emulated/0:/storage/emulated/0 -- bash -c "cd /root/fotohaven && pm2 start ecosystem.config.js"

sleep 5

# 2. Start Cloudflare Quick Tunnel in bare Termux and save URL
cd /data/data/com.termux/files/home/fotohaven
./start-cloudflare-tunnel.sh
BOOT

chmod +x "$BOOT_SCRIPT"
ok "Boot script created at $BOOT_SCRIPT"

# Disable the Tailscale boot script if it exists
if [ -f "$TERMUX_HOME/.termux/boot/start-fotohaven-ubuntu.sh" ]; then
  mv "$TERMUX_HOME/.termux/boot/start-fotohaven-ubuntu.sh" "$TERMUX_HOME/.termux/boot/start-fotohaven-ubuntu.sh.disabled"
  ok "Disabled Tailscale boot script"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Cloudflare Quick Tunnel Setup Complete!                ║"
echo "║                                                          ║"
echo "║   You are now configured to use Quick Tunnels instead    ║"
echo "║   of Tailscale.                                          ║"
echo "║                                                          ║"
echo "║   How to start it now:                                   ║"
echo "║   cd ~/fotohaven && ./start-cloudflare-tunnel.sh         ║"
echo "║                                                          ║"
echo "║   To view your URL at any time:                          ║"
echo "║   cat ~/fotohaven/cloudflare-url.txt                     ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${RESET}"
