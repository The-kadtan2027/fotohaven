#!/data/data/com.termux/files/usr/bin/bash
# infra/android/ubuntu-proot-setup.sh
#
# Automates the migration of FotoHaven from bare Termux to Ubuntu proot-distro.
#
# This script:
# 1. Installs proot-distro and the Ubuntu 24.04 image
# 2. Logs into Ubuntu and installs Node.js 20, PM2, and build tools
# 3. Cleans node_modules and recompiles them for Ubuntu's glibc
# 4. Sets up PM2 to manage the FotoHaven process
# 5. Creates a unified boot script for Termux:Boot

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

TERMUX_HOME="/data/data/com.termux/files/home"
PROJECT_DIR="$TERMUX_HOME/fotohaven"

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════╗"
echo "║   FotoHaven — Ubuntu Proot Migration             ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${RESET}"

# ── Step 1: Install proot-distro & Ubuntu ─────────────────────────────────────
step "Installing proot-distro & Ubuntu"
pkg install -y proot-distro
if proot-distro list | grep -q "ubuntu.*installed"; then
  ok "Ubuntu is already installed via proot-distro"
else
  warn "Installing Ubuntu image (this may take a minute or two)..."
  proot-distro install ubuntu
  ok "Ubuntu installed"
fi

# ── Step 2: Create the inside-Ubuntu init script ──────────────────────────────
step "Creating Ubuntu initialization script"
INIT_SCRIPT="$PROJECT_DIR/infra/android/.ubuntu-init.sh"

cat > "$INIT_SCRIPT" << 'EOF'
#!/bin/bash
set -e

echo "[Ubuntu] Updating apt and installing dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt update
apt install -y curl git build-essential python3 nano ca-certificates

echo "[Ubuntu] Installing Node.js 20 LTS..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1)" != "v20" ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

echo "[Ubuntu] Installing PM2 globally..."
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

# Create symlink for easier access
ln -sf /data/data/com.termux/files/home/fotohaven /root/fotohaven

cd /root/fotohaven

echo "[Ubuntu] Cleaning Termux node_modules for glibc rebuild..."
# We MUST wipe these to recompile better-sqlite3 for Ubuntu's glibc
rm -rf node_modules .next package-lock.json

echo "[Ubuntu] Running npm install (compiling native modules)..."
npm install

echo "[Ubuntu] Pushing DB schema to local.db..."
npm run db:push

echo "[Ubuntu] Building Next.js application..."
npm run build

echo "[Ubuntu] Setup complete inside proot!"
EOF

chmod +x "$INIT_SCRIPT"
ok "Created .ubuntu-init.sh"

# ── Step 3: Execute init script inside Ubuntu ─────────────────────────────────
step "Executing initialization inside Ubuntu proot (this will take several minutes)"
proot-distro login ubuntu --shared-tmp -- bash -c "$INIT_SCRIPT"
ok "Ubuntu environment successfully initialized and app built"

# ── Step 4: Boot Script Configuration ─────────────────────────────────────────
step "Configuring Boot Script"
BOOT_SCRIPT="$TERMUX_HOME/.termux/boot/start-fotohaven-ubuntu.sh"
mkdir -p "$(dirname "$BOOT_SCRIPT")"

cat > "$BOOT_SCRIPT" << 'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
# Auto-start: Tailscale (Termux) + FotoHaven (Ubuntu Proot)
# Requires Termux:Boot app

TS_SOCKET="/data/data/com.termux/files/usr/run/tailscaled.sock"
TS_STATE="/data/data/com.termux/files/home/.config/tailscale"

sleep 15

# 1. Start Tailscale daemon in bare Termux
if ! pgrep -x "tailscaled" > /dev/null 2>&1; then
  tailscaled \
    --tun=userspace-networking \
    --socket="$TS_SOCKET" \
    --statedir="$TS_STATE" \
    --state="$TS_STATE/tailscaled.state" \
    > /dev/null 2>&1 &
  sleep 5
fi

# Bring up the Tailscale connection and start Funnel
tailscale --socket="$TS_SOCKET" up
tailscale --socket="$TS_SOCKET" funnel 3000 &

# 2. Start PM2 inside Ubuntu proot
proot-distro login ubuntu --shared-tmp -- bash -c "cd /root/fotohaven && pm2 start ecosystem.config.js"
BOOT

chmod +x "$BOOT_SCRIPT"
ok "Boot script created at $BOOT_SCRIPT"

# Clean up the old tailscale boot script so they don't conflict
if [ -f "$TERMUX_HOME/.termux/boot/start-tailscale.sh" ]; then
  mv "$TERMUX_HOME/.termux/boot/start-tailscale.sh" "$TERMUX_HOME/.termux/boot/start-tailscale.sh.disabled"
  ok "Disabled old start-tailscale.sh boot script to prevent conflicts"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Ubuntu Proot Migration Complete!                       ║"
echo "║                                                          ║"
echo "║   What to do next:                                       ║"
echo "║                                                          ║"
echo "║   1. Start the app manually for the first time:          ║"
echo "║      proot-distro login ubuntu --shared-tmp -- bash -c \"cd /root/fotohaven && pm2 start ecosystem.config.js && pm2 save\""
echo "║                                                          ║"
echo "║   2. Start Tailscale Funnel in Termux (if not running):  ║"
echo "║      tailscale --socket=$TERMUX_HOME/../usr/run/tailscaled.sock funnel 3000 &"
echo "║                                                          ║"
echo "║   Note: I did NOT delete 'stale' files (like Prisma      ║"
echo "║   workarounds) per your request, although they are       ║"
echo "║   no longer needed.                                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${RESET}"
