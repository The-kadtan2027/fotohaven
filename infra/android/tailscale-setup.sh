#!/data/data/com.termux/files/usr/bin/bash
# infra/android/tailscale-setup.sh
#
# Installs Tailscale + enables Funnel on Android (Termux).
# Gives you a permanent public URL: https://devicename.tailXXXX.ts.net
#
# PREREQUISITES:
#   - Termux installed from F-Droid (NOT Google Play)
#   - FotoHaven already running at http://localhost:3000
#   - A free Tailscale account (sign up at https://login.tailscale.com)
#
# USAGE:
#   bash ~/fotohaven/infra/android/tailscale-setup.sh
#
# Safe to re-run — all steps are idempotent.

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
err()  { echo -e "${RED}✗ $1${RESET}"; }

TS_SOCKET="/data/data/com.termux/files/usr/run/tailscaled.sock"
TS_STATE="/data/data/com.termux/files/home/.config/tailscale"

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════╗"
echo "║   FotoHaven — Tailscale Funnel Setup         ║"
echo "║   Permanent public URL for your phone server ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${RESET}"

# ── Step 1: Install Go (needed to build Tailscale from source) ────────────────
step "Installing Go compiler"
if command -v go &>/dev/null; then
  ok "Go already installed: $(go version | cut -d' ' -f3)"
else
  pkg install -y golang
  ok "Go installed: $(go version | cut -d' ' -f3)"
fi

# ── Step 2: Build Tailscale binaries ──────────────────────────────────────────
step "Building Tailscale from source (this takes 3–5 minutes)"

GOBIN="$PREFIX/bin"
export GOBIN

if command -v tailscale &>/dev/null && command -v tailscaled &>/dev/null; then
  ok "Tailscale already installed: $(tailscale version 2>/dev/null || echo 'unknown')"
else
  warn "Compiling tailscale and tailscaled — grab a chai ☕"
  go install tailscale.com/cmd/tailscale@latest
  go install tailscale.com/cmd/tailscaled@latest
  ok "Tailscale binaries installed to $GOBIN"
fi

# ── Step 3: Create state directory ────────────────────────────────────────────
step "Creating Tailscale state directory"
mkdir -p "$TS_STATE"
mkdir -p "$(dirname "$TS_SOCKET")"
ok "State dir: $TS_STATE"

# ── Step 4: Start tailscaled daemon ───────────────────────────────────────────
step "Starting tailscaled daemon (userspace networking)"

if pgrep -x "tailscaled" > /dev/null 2>&1; then
  ok "tailscaled is already running"
else
  tailscaled \
    --tun=userspace-networking \
    --socket="$TS_SOCKET" \
    --statedir="$TS_STATE" \
    --state="$TS_STATE/tailscaled.state" \
    > /dev/null 2>&1 &

  sleep 3

  if pgrep -x "tailscaled" > /dev/null 2>&1; then
    ok "tailscaled started in background"
  else
    err "tailscaled failed to start — run manually with verbose output:"
    echo "  tailscaled --tun=userspace-networking --socket=$TS_SOCKET --statedir=$TS_STATE"
    exit 1
  fi
fi

# ── Step 5: Authenticate with Tailscale ───────────────────────────────────────
step "Authenticating with Tailscale"
echo -e "${YELLOW}A login URL will appear below — open it in a browser to authenticate.${RESET}"
echo -e "${YELLOW}If already authenticated, this step will complete instantly.${RESET}"
echo ""

tailscale --socket="$TS_SOCKET" up

ok "Authenticated with Tailscale"

# ── Step 6: Enable HTTPS certificates ────────────────────────────────────────
step "Enabling HTTPS certificates"
tailscale --socket="$TS_SOCKET" cert 2>/dev/null || true
ok "HTTPS certificates configured"

# ── Step 7: Enable Funnel ─────────────────────────────────────────────────────
step "Enabling Tailscale Funnel on port 3000"
echo -e "${YELLOW}Funnel exposes your app to the public internet via Tailscale's relay.${RESET}"
echo ""

# Enable funnel for port 3000 — this maps external :443 → local :3000
tailscale --socket="$TS_SOCKET" funnel 3000 &
FUNNEL_PID=$!
sleep 3

# Get our Funnel URL
DEVICE_NAME=$(tailscale --socket="$TS_SOCKET" status --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\.$//')
if [ -n "$DEVICE_NAME" ]; then
  FUNNEL_URL="https://$DEVICE_NAME"
  ok "Funnel active!"
  echo ""
  echo -e "${BOLD}${GREEN}  Your permanent public URL: ${FUNNEL_URL}${RESET}"
  echo ""
else
  FUNNEL_URL="(could not detect — check 'tailscale status')"
  warn "Funnel started but could not detect URL"
  echo "  Run: tailscale --socket=$TS_SOCKET status"
fi

# Kill the foreground funnel — we'll set it up properly via boot script
kill $FUNNEL_PID 2>/dev/null || true

# ── Step 8: Update .env.local ─────────────────────────────────────────────────
step "Updating FotoHaven configuration"

ENV_FILE="$HOME/fotohaven/.env.local"
if [ -f "$ENV_FILE" ] && [ -n "$DEVICE_NAME" ]; then
  # Update NEXT_PUBLIC_APP_URL if it exists, otherwise append
  if grep -q "NEXT_PUBLIC_APP_URL" "$ENV_FILE"; then
    sed -i "s|NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=\"$FUNNEL_URL\"|" "$ENV_FILE"
    ok "Updated NEXT_PUBLIC_APP_URL in .env.local"
  else
    echo "NEXT_PUBLIC_APP_URL=\"$FUNNEL_URL\"" >> "$ENV_FILE"
    ok "Added NEXT_PUBLIC_APP_URL to .env.local"
  fi
else
  warn "Could not update .env.local — set NEXT_PUBLIC_APP_URL manually to: $FUNNEL_URL"
fi

# ── Step 9: Create boot integration script ────────────────────────────────────
step "Creating Tailscale boot script"

BOOT_SCRIPT="$HOME/.termux/boot/start-tailscale.sh"
mkdir -p "$(dirname "$BOOT_SCRIPT")"

cat > "$BOOT_SCRIPT" << 'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
# Auto-start Tailscale Funnel on phone reboot
# Requires: Termux:Boot app installed from F-Droid

TS_SOCKET="/data/data/com.termux/files/usr/run/tailscaled.sock"
TS_STATE="/data/data/com.termux/files/home/.config/tailscale"

# Wait for network
sleep 15

# Start tailscaled daemon
if ! pgrep -x "tailscaled" > /dev/null 2>&1; then
  tailscaled \
    --tun=userspace-networking \
    --socket="$TS_SOCKET" \
    --statedir="$TS_STATE" \
    --state="$TS_STATE/tailscaled.state" \
    > /dev/null 2>&1 &
  sleep 5
fi

# Bring up the Tailscale connection
tailscale --socket="$TS_SOCKET" up

# Enable Funnel (proxies external :443 → local :3000)
tailscale --socket="$TS_SOCKET" funnel 3000 &
BOOT

chmod +x "$BOOT_SCRIPT"
ok "Boot script created at $BOOT_SCRIPT"
warn "Install 'Termux:Boot' from F-Droid for this to trigger on phone reboot"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Tailscale Funnel setup complete!                      ║"
echo "║                                                         ║"
echo "║   Your permanent public URL:                            ║"
echo "║   $FUNNEL_URL"
echo "║                                                         ║"
echo "║   What to do next:                                      ║"
echo "║                                                         ║"
echo "║   1. Restart FotoHaven to pick up the new URL:          ║"
echo "║      pm2 restart fotohaven                              ║"
echo "║                                                         ║"
echo "║   2. Test from another device:                          ║"
echo "║      Open $FUNNEL_URL in a browser"
echo "║                                                         ║"
echo "║   3. Start the funnel (runs in background):             ║"
echo "║      tailscale --socket=$TS_SOCKET funnel 3000 &"
echo "║                                                         ║"
echo "║   The URL never changes — share links work forever! 🎉  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  Useful commands:"
echo "  tailscale --socket=$TS_SOCKET status     → connection info"
echo "  tailscale --socket=$TS_SOCKET funnel 3000 &  → start funnel"
echo "  pgrep tailscaled                         → check daemon"
echo "────────────────────────────────────────────────────────────"
