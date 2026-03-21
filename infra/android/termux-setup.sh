#!/data/data/com.termux/files/usr/bin/bash
# infra/android/termux-setup.sh
#
# One-shot bootstrap script — run this inside Termux after fresh install.
# Sets up everything needed to host FotoHaven on your Android phone.
#
# Usage:
#   bash termux-setup.sh
#
# Safe to re-run — all steps are idempotent.

set -e  # exit on any error

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
RESET="\033[0m"

step() { echo -e "\n${BOLD}${CYAN}▶ $1${RESET}"; }
ok()   { echo -e "${GREEN}✓ $1${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $1${RESET}"; }

echo -e "${BOLD}"
echo "╔══════════════════════════════════════╗"
echo "║   FotoHaven — Android Server Setup   ║"
echo "╚══════════════════════════════════════╝"
echo -e "${RESET}"

# ── Step 1: Update package index ──────────────────────────────────────────────
step "Updating Termux packages"
pkg update -y && pkg upgrade -y
ok "Packages up to date"

# ── Step 2: Core dependencies ──────────────────────────────────────────────────
step "Installing core dependencies"
pkg install -y nodejs git curl wget nano openssh python make clang
ok "Node $(node -v), Git $(git --version | cut -d' ' -f3) installed"

# ── Step 3: Storage access ─────────────────────────────────────────────────────
step "Requesting storage permission"
warn "A popup will appear asking for storage access — tap ALLOW"
termux-setup-storage
sleep 2
ok "Storage permission granted (files accessible at ~/storage)"

# ── Step 4: PM2 process manager ───────────────────────────────────────────────
step "Installing PM2 process manager"
npm install -g pm2
ok "PM2 $(pm2 --version) installed"

# ── Step 5: Install cloudflared (Termux native) ───────────────────────────────
step "Installing cloudflared (Cloudflare Tunnel)"
pkg install -y cloudflared
ok "cloudflared installed: $(cloudflared --version)"

# ── Step 6: Clone FotoHaven ────────────────────────────────────────────────────
step "Cloning FotoHaven"
if [ -d "$HOME/fotohaven" ]; then
  warn "~/fotohaven already exists — pulling latest changes"
  cd "$HOME/fotohaven" && git pull
else
  warn "Enter your FotoHaven git repo URL (or press Enter to skip if copying manually):"
  read -r REPO_URL
  if [ -n "$REPO_URL" ]; then
    git clone "$REPO_URL" "$HOME/fotohaven"
    ok "Cloned to ~/fotohaven"
  else
    warn "Skipped clone — make sure ~/fotohaven exists before continuing"
  fi
fi

# ── Step 7: Install npm dependencies ──────────────────────────────────────────
step "Installing npm dependencies"
cd "$HOME/fotohaven"

# Termux workaround: node-gyp tries to find the Android NDK when compiling
# C++ modules (like better-sqlite3) on OS=android. We pass an empty string
# to prevent it from crashing with "Undefined variable android_ndk_path".
export npm_config_android_ndk_path=""

npm install
ok "npm dependencies installed"

# ── Step 8: Environment file ───────────────────────────────────────────────────
step "Setting up environment file"
if [ ! -f ".env.local" ]; then
  cp .env.example .env.local
  warn ".env.local created from .env.example"
  warn "IMPORTANT: Edit .env.local with your actual values:"
  warn "  nano .env.local"
else
  ok ".env.local already exists"
fi

# ── Step 9: Drizzle DB bootstrap ──────────────────────────────────────────────
step "Bootstrapping database"
# Write an absolute DATABASE_URL to .env for local script execution
DB_PATH="$HOME/fotohaven/local.db"
echo "DATABASE_URL=\"file:${DB_PATH}\"" > .env

# Push the connection and schema
npm run db:push

ok "SQLite database created at ${DB_PATH}"

# ── Step 10: Build Next.js ─────────────────────────────────────────────────────
step "Building Next.js for production"
npm run build
ok "Build complete"

# ── Step 11: Termux boot service (auto-start on phone reboot) ─────────────────
step "Setting up boot auto-start"
pkg install -y termux-services
mkdir -p "$HOME/.termux/boot"

# This script runs when the phone boots (requires Termux:Boot app)
cat > "$HOME/.termux/boot/start-fotohaven.sh" << 'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
# Auto-start FotoHaven and Cloudflare Tunnel on phone reboot
# Requires: Termux:Boot app installed from F-Droid

cd ~/fotohaven

# Wait for network
sleep 10

# Start app
pm2 start ecosystem.config.js
pm2 save

# Start tunnel (edit path to your config)
cloudflared tunnel --config ~/fotohaven/infra/android/cloudflared-config.yml run &
BOOT

chmod +x "$HOME/.termux/boot/start-fotohaven.sh"
ok "Boot script created at ~/.termux/boot/start-fotohaven.sh"
warn "Install 'Termux:Boot' from F-Droid for this to trigger on phone reboot"

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║   Setup complete! What to do next:               ║"
echo "║                                                  ║"
echo "║  1. Edit your env file:                          ║"
echo "║     nano ~/fotohaven/.env.local                  ║"
echo "║                                                  ║"
echo "║  2. Start the app:                               ║"
echo "║     cd ~/fotohaven && pm2 start ecosystem.config.js ║"
echo "║                                                  ║"
echo "║  3. Set up Cloudflare Tunnel:                    ║"
echo "║     cloudflared tunnel login                     ║"
echo "║     cloudflared tunnel create fotohaven          ║"
echo "║                                                  ║"
echo "║  4. Verify it's running:                         ║"
echo "║     pm2 status                                   ║"
echo "║     pm2 logs fotohaven                           ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${RESET}"
