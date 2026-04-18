# FotoHaven 📷

> Secure photo handoff platform for event photographers and clients.  
> Runs on **your old Android phone** — no cloud servers, no monthly bills.

Upload selected photos by ceremony, generate a share link, hand off to your photographer. No WhatsApp zips. No Google Drive chaos.

---

## Table of Contents

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Hosting Options](#hosting-options)
5. [Android Phone Hosting Guide](#android-phone-hosting-guide)
   - [What you need](#what-you-need)
   - [Step 1 — Install Termux](#step-1--install-termux)
   - [Step 2 — Bootstrap the environment](#step-2--bootstrap-the-environment)
   - [Step 3 — Get the code on the phone](#step-3--get-the-code-on-the-phone)
   - [Step 4 — Configure environment](#step-4--configure-environment)
   - [Step 5 — Choose your storage mode](#step-5--choose-your-storage-mode)
   - [Step 6 — Build and run](#step-6--build-and-run)
   - [Step 7 — Expose to the internet](#step-7--expose-to-the-internet-cloudflare-tunnel)
   - [Step 8 — Auto-start on reboot](#step-8--auto-start-on-reboot)
   - [Step 9 — Set up backups](#step-9--set-up-backups)
   - [Keeping it healthy](#keeping-it-healthy)
   - [Troubleshooting](#troubleshooting)
6. [Standard Setup (PC / VPS)](#standard-setup-pc--vps)
7. [User Flow](#user-flow)
8. [API Reference](#api-reference)
9. [Roadmap](#roadmap)

---

## Features

- **Multi-ceremony albums** — organise into Mehndi, Sangeet, Wedding, Reception, etc.
- **Drag-and-drop upload** — browser uploads directly to storage (R2 or local phone disk)
- **Shareable links** — token-based URLs with optional expiry date
- **Password-protected links** — bcrypt-hashed album passwords with a client-side challenge screen
- **Admin Dashboard** — JWT-protected dashboard showing global stats (total albums, photos, client selections) and detailed album cards with expiry badges and `firstViewedAt` statuses
- **Photographer gallery** — browse by ceremony, lightbox preview, select individual photos
- **Client photo selection** — clients star/select photos on the share page; selections persist across sessions and are visible to the photographer in the album manager
- **Batch photo management** — select multiple photos to delete or download as a ZIP
- **Advanced album management** — per-album upload compression defaults, duplicate review, admin-only blur tools, and progressive lightbox viewing
- **Server-side ZIP streaming** — large albums download efficiently without crashing mobile browsers
- **Fast thumbnail generation** — uploads are automatically downscaled for quick gallery viewing; original high-res photos are kept for ZIP downloads
- **Per-photo comments** — photographer and client can annotate individual photos with notes
- **Email notifications** — photographer receives an email on first gallery view (via Resend)
- **Upload-back flow** — photographer can upload edited finals back into the album via share link; client downloads them in a separate "Delivered Finals" tab
- **Guest face discovery** — guests can verify via OTP, scan once, and see likely photo matches ranked by confidence
- **Face reprocessing reset** — photographer can clear stale face descriptors for an album and rebuild them with the latest browser-side pipeline

---

## Tech Stack

| Layer      | Choice                         | Why                                                   |
|------------|--------------------------------|-------------------------------------------------------|
| Framework  | Next.js 15 (App Router)        | API routes + React UI in one repo                     |
| Database   | SQLite via Drizzle ORM         | Single file, zero config, ARM-native, no engine       |
| Storage    | Cloudflare R2 or local disk    | R2 for cloud; phone SD card for fully-offline hosting |
| Email      | Resend                         | Simple API, generous free tier                        |
| Auth       | bcryptjs (honour-system)       | Password-hashed album links, no user accounts         |
| Process    | PM2                            | Keeps Node alive, restarts on crash, survives reboots |
| Tunnel     | Cloudflare Tunnel / Tailscale Funnel | Public URL without port-forwarding or static IP       |
| Fonts      | Cormorant Garamond + DM Sans   | Luxury editorial aesthetic                            |

---

## Project Structure

```
fotohaven/
├── drizzle/                        # Generated SQL migrations
│   ├── 0000_clumsy_mad_thinker.sql
│   └── meta/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                # Dashboard
│   │   ├── albums/
│   │   │   ├── new/page.tsx        # Create album (3-step form)
│   │   │   └── [albumId]/page.tsx  # Album manager + uploader + Finals download
│   │   ├── share/[token]/page.tsx  # Client gallery + Originals/Finals tabs + Upload Returns
│   │   └── api/
│   │       ├── albums/route.ts
│   │       ├── albums/[albumId]/route.ts
│   │       ├── upload/route.ts
│   │       ├── upload/local/route.ts   # Local-storage upload handler
│   │       ├── files/[...key]/route.ts # Local file serving
│   │       ├── comments/route.ts       # Per-photo comments (GET / POST)
│   │       └── share/
│   │           └── [token]/
│   │               ├── route.ts        # Gallery data + password + email trigger
│   │               └── upload/route.ts # Photographer returns (isReturn: true)
│   ├── lib/
│   │   ├── schema.ts               # Drizzle table definitions (single source of truth)
│   │   ├── db.ts                   # Drizzle + better-sqlite3 client
│   │   ├── storage.ts              # R2 / local storage abstraction
│   │   └── email.ts                # Resend email utility
│   └── types/index.ts
├── infra/
│   └── android/
│       ├── termux-setup.sh         # One-shot bootstrap script
│       ├── cloudflared-config.yml  # Cloudflare Tunnel config
│       ├── cloudflared-quick-setup.sh # Cloudflare Quick Tunnel (No Login) Setup
│       ├── ubuntu-proot-setup.sh   # Ubuntu proot migration script
│       ├── tailscale-setup.sh      # Tailscale Funnel setup (alternative tunnel)
│       ├── tailscale-setup-alpine.sh # Tailscale setup for Alpine proot
│       ├── health-check.sh         # Server status checker
│       └── backup.sh               # DB + photo backup
├── drizzle.config.js               # Drizzle Kit configuration
├── ecosystem.config.js             # PM2 process config
├── .env.example
└── package.json
```

---

## Hosting Options

| Option                   | Cost             | Difficulty | Best for                                |
|--------------------------|------------------|------------|-----------------------------------------|
| **Android phone** (this guide) | ₹0         | Medium     | Learning, personal use, always-on home server |
| Vercel + Neon            | Free → ~₹1600/mo | Easy       | Production, public-facing               |
| VPS (Hetzner)            | ~₹500/mo         | Medium     | Production with full control            |
| Raspberry Pi             | One-time ~₹3000  | Medium     | Dedicated home server                   |

---

## Android Phone Hosting Guide

Your old Android phone is a capable ARM Linux machine (runs natively in Termux, or inside an Ubuntu PRoot/Chroot environment for better compatibility via `infra/android/ubuntu-proot-setup.sh`):
- Multi-core CPU — runs Node.js comfortably
- 2–4 GB RAM — Next.js uses ~150–250 MB
- Built-in battery = free UPS (stays up during power cuts)
- WiFi built in, no moving parts, near-silent

The goal: plug it in, point a domain at it, forget about it.

### What you need

| Item | Notes |
|------|-------|
| Android phone | Android 7+, any brand |
| Charger + cable | Phone stays plugged in permanently |
| Stable WiFi | Home broadband |
| Cloudflare account | Free — [dash.cloudflare.com](https://dash.cloudflare.com) |
| Domain name (optional) | ~₹800/yr from Namecheap; or use free `*.trycloudflare.com` |
| F-Droid app | [f-droid.org](https://f-droid.org) — open-source app store |


> **No rooting required.** Everything runs inside Termux's userspace.

---

### Step 1 — Install Termux

> ⚠️ **Do NOT install Termux from Google Play Store** — that version is frozen and broken. Use F-Droid only.

1. On the phone browser, go to **[f-droid.org](https://f-droid.org)**
2. Download and install F-Droid (allow "Install from unknown sources" in Settings)
3. Open F-Droid → search **Termux** → install
4. Also search and install **Termux:Boot** (for auto-start after reboot)

Open Termux. You'll see a bash prompt — this is your Linux server.

---

### Step 2 — Bootstrap the environment

Run the one-shot setup script inside Termux:

```bash
# Update Termux packages first
pkg update -y

# If you already have the repo on the phone:
bash ~/fotohaven/infra/android/termux-setup.sh

# Or run directly from GitHub (replace with your repo URL):
curl -fsSL https://raw.githubusercontent.com/The-kadtan2027/fotohaven/main/infra/android/termux-setup.sh | bash
```

The script installs: `nodejs`, `git`, `curl`, `wget`, `openssh`, `pm2`, `cloudflared` (ARM64), requests storage permission, installs npm deps, runs `drizzle-kit push`, builds Next.js, and sets up the reboot boot script.

> To do it manually step-by-step, read `infra/android/termux-setup.sh` — every command is documented inline.

---

### Step 3 — Get the code on the phone

**Option A — Git clone (easiest)**

```bash
cd ~
git clone https://github.com/The-kadtan2027/fotohaven.git
cd fotohaven
```

**Option B — USB transfer**

```bash
# Phone storage is accessible in Termux at:
ls ~/storage/shared/

# Copy to Termux home:
cp -r ~/storage/shared/fotohaven ~/fotohaven
cd ~/fotohaven
```

**Option C — WiFi / SSH**

```bash
# On the phone, start SSH:
sshd
ifconfig   # note the wlan0 IP address

# On your PC:
scp -P 8022 -r ./fotohaven youruser@192.168.x.x:~/fotohaven
```

---

### Step 4 — Configure environment

```bash
cd ~/fotohaven
cp .env.example .env.local
nano .env.local
```

```env
# Database — SQLite file (Drizzle ORM)
DATABASE_URL="file:./local.db"

# Your public URL (set after Step 7 when you have a domain/tunnel URL)
NEXT_PUBLIC_APP_URL="https://fotohaven.yourdomain.com"

# ── Storage: pick Option A or B from Step 5 ──

# Option A — Cloudflare R2:
R2_ACCOUNT_ID="your_account_id"
R2_ACCESS_KEY_ID="your_key"
R2_SECRET_ACCESS_KEY="your_secret"
R2_BUCKET_NAME="fotohaven"
R2_PUBLIC_URL="https://pub-xxxx.r2.dev"

# Option B — Local phone storage:
# LOCAL_UPLOAD_PATH="/data/data/com.termux/files/home/storage/shared/fotohaven-uploads"

# Email notifications (optional — get key at resend.com)
RESEND_API_KEY=""

# App secret (generate below)
APP_SECRET="paste_generated_secret_here"
```

Generate the app secret:
```bash
openssl rand -hex 32
# copy the output into APP_SECRET above
```

---

### Step 5 — Choose your storage mode

#### Option A — Cloudflare R2 (recommended)

Photos go to Cloudflare's cloud. Phone only handles app logic + database. Phone storage doesn't fill up. Photos survive if the phone dies. R2 free tier: **10 GB + 1M reads/month** — plenty for personal use.

**Setup:**
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage** → **Create bucket** → name: `fotohaven`
2. Bucket → **Settings → Public Access** → **Allow Public Access**
3. R2 overview → **Manage R2 API Tokens** → **Create API Token** → Object Read & Write on `fotohaven`
4. Copy Account ID, Access Key, Secret Key into `.env.local`
5. Copy the R2.dev public URL into `R2_PUBLIC_URL`

Add CORS rule (Bucket → Settings → CORS):
```json
[
  {
    "AllowedOrigins": ["https://fotohaven.yourdomain.com"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

No code changes needed — `src/lib/storage.ts` is already R2-ready.

#### Option B — Local phone storage

Photos saved directly to phone disk. No cloud account needed. Good for LAN-only use or if you want everything self-contained.

```bash
mkdir -p ~/storage/shared/fotohaven-uploads
```

Add to `.env.local`:
```env
LOCAL_UPLOAD_PATH="/data/data/com.termux/files/home/storage/shared/fotohaven-uploads"
```

Photos appear in your phone's **Files app** under Internal Storage → fotohaven-uploads.

---

### Step 6 — Build and run

```bash
cd ~/fotohaven

# Initialise the database (Drizzle)
npm run db:push

# Build for production
npm run build

# Start with PM2
pm2 start ecosystem.config.js

# Check it's running
pm2 status
pm2 logs fotohaven --lines 20
```

Expected PM2 output:
```
┌────┬──────────────┬──────┬─────────┬──────────┐
│ id │ name         │ mode │ status  │ memory   │
├────┼──────────────┼──────┼─────────┼──────────┤
│ 0  │ fotohaven    │ fork │ online  │ 185mb    │
└────┴──────────────┴──────┴─────────┴──────────┘
```

Test locally:
```bash
curl http://localhost:3000
# Should return HTML
```

---

### Step 7 — Expose to the internet

You need a tunnel to make your phone server accessible from outside your home network. Two options:

| | Option A: Cloudflare Tunnel | Option B: Tailscale Funnel |
|---|---|---|
| **Best for** | Custom domain, production use | Quick setup, educational/personal use |
| **Cost** | Free | Free (Personal plan) |
| **Requires** | Cloudflare account + domain (or use quick tunnel) | Tailscale account (Google/GitHub login) |
| **URL stability** | ✅ Permanent (with domain) / ⚠️ Random (quick tunnel) | ✅ Permanent always |
| **HTTPS** | ✅ Automatic | ✅ Automatic |
| **Bandwidth** | Unlimited | Undisclosed limits (fine for photo sharing) |
| **Setup time** | ~5 min | ~15 min (builds from source) |

#### Option A — Cloudflare Tunnel

Cloudflare Tunnel creates an encrypted outbound connection from your phone to Cloudflare's global edge network. No port forwarding, no static IP, no router settings.

**7a — Authenticate**
```bash
cloudflared tunnel login
# Opens a URL — open in browser, log in, select your domain
```

**7b — Create the tunnel**
```bash
cloudflared tunnel create fotohaven
# Prints: Created tunnel fotohaven with id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# Save this UUID
```

**7c — Edit the config file**
```bash
nano ~/fotohaven/infra/android/cloudflared-config.yml
```

Replace placeholders:
```yaml
tunnel: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
credentials-file: /data/data/com.termux/files/home/.cloudflared/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json

ingress:
  - hostname: fotohaven.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

**7d — Route DNS**
```bash
cloudflared tunnel route dns fotohaven fotohaven.yourdomain.com
# Auto-creates a CNAME in your Cloudflare DNS
```

**7e — Start the tunnel**
```bash
cloudflared tunnel --config ~/fotohaven/infra/android/cloudflared-config.yml run &
```

Your app is now live at `https://fotohaven.yourdomain.com` 🎉

> **Quick test with no domain (Automated):**
> Run `bash ~/fotohaven/infra/android/start-cloudflare.sh` to automatically start a Quick Tunnel, grab the new `*.trycloudflare.com` URL, inject it into `.env.local`, and restart Next.js to apply the correct base URL.

#### Option B — Tailscale Funnel (recommended for experiments)

Tailscale Funnel gives you a **permanent public URL** (`https://devicename.tailXXXX.ts.net`) with zero configuration. No domain purchase needed. URL never changes across restarts — share links work forever.

**Automated setup** — run the one-shot script:
```bash
bash ~/fotohaven/infra/android/tailscale-setup.sh
```

This script:
1. Installs Go compiler (needed to build Tailscale for ARM)
2. Builds `tailscale` and `tailscaled` from source (~3–5 min)
3. Starts the daemon in userspace mode (no root needed)
4. Authenticates via browser link
5. Enables Funnel (proxies external `:443` → local `:3000`)
6. Updates `.env.local` with your permanent URL
7. Creates a boot script for auto-start

**Manual setup** — if you prefer step by step:

```bash
# Install Go
pkg install -y golang

# Build Tailscale
go install tailscale.com/cmd/tailscale@latest
go install tailscale.com/cmd/tailscaled@latest

# Start daemon (userspace, no root)
tailscaled --tun=userspace-networking \
  --socket=/data/data/com.termux/files/usr/run/tailscaled.sock \
  --statedir=/data/data/com.termux/files/home/.config/tailscale &

# Authenticate (opens a URL — log in with Google/GitHub)
tailscale --socket=/data/data/com.termux/files/usr/run/tailscaled.sock up

# Enable Funnel — maps your public URL to localhost:3000
tailscale --socket=/data/data/com.termux/files/usr/run/tailscaled.sock funnel 3000 &

# Check your URL
tailscale --socket=/data/data/com.termux/files/usr/run/tailscaled.sock status
# → Your URL is: https://devicename.tailXXXX.ts.net
```

After setup, update your environment:
```bash
# Edit .env.local — set your permanent URL
nano ~/fotohaven/.env.local
# NEXT_PUBLIC_APP_URL="https://devicename.tailXXXX.ts.net"

# Restart (NO rebuild needed — this is a server-side variable)
pm2 restart fotohaven
```

> **Note on bandwidth:** Tailscale says Funnel is "a funnel, not a hose." For occasional photo sharing with individual photographers (not serving thousands of users), this is perfectly fine. If you need higher throughput, use Cloudflare Tunnel (Option A).

---

### Step 8 — Auto-start on reboot

**8a — Save PM2 state**
```bash
pm2 save
```

**8b — Activate Termux:Boot**

Open the **Termux:Boot** app once (just launch and close it). This registers the boot trigger.

**If using Cloudflare Tunnel (Option A):**

The bootstrap script already created `~/.termux/boot/start-fotohaven.sh`. Verify:
```bash
cat ~/.termux/boot/start-fotohaven.sh
```

Should contain:
```bash
#!/data/data/com.termux/files/usr/bin/bash
cd ~/fotohaven
sleep 10   # wait for WiFi
pm2 resurrect
cloudflared tunnel --config ~/fotohaven/infra/android/cloudflared-config.yml run &
```

**If using Tailscale Funnel (Option B):**

The Tailscale setup script creates `~/.termux/boot/start-tailscale.sh` automatically. Verify:
```bash
cat ~/.termux/boot/start-tailscale.sh
```

Should contain:
```bash
#!/data/data/com.termux/files/usr/bin/bash
TS_SOCKET="/data/data/com.termux/files/usr/run/tailscaled.sock"
TS_STATE="/data/data/com.termux/files/home/.config/tailscale"
sleep 15
tailscaled --tun=userspace-networking --socket="$TS_SOCKET" --statedir="$TS_STATE" --state="$TS_STATE/tailscaled.state" &
sleep 5
tailscale --socket="$TS_SOCKET" up
tailscale --socket="$TS_SOCKET" funnel 3000 &
```

**8c — Critical: Disable battery optimisation**

Android kills background processes to save battery. You must disable this for Termux:

1. **Settings → Battery** → find **Termux** → set to **Unrestricted**
2. Do the same for **Termux:Boot**
3. Keep phone permanently plugged into charger (battery acts as UPS, won't overheat at 100%)

> **Samsung phones** have an extra step: Settings → Device Care → Battery → Background usage limits → remove Termux from the list.

---

### Step 9 — Set up backups

**Run a backup now:**
```bash
bash ~/fotohaven/infra/android/backup.sh
```

Saves a timestamped copy to `~/storage/shared/fotohaven-backups/`. Visible in the Files app — copy to Google Drive or PC from there.

**Automate with cron (daily at 2am):**
```bash
crontab -e
# Add this line:
0 2 * * * bash ~/fotohaven/infra/android/backup.sh >> ~/.pm2/logs/backup.log 2>&1
```

| What | Where |
|------|-------|
| SQLite database | `local.db` — all albums, ceremonies, photo metadata |
| `.env.local` | Config + secrets |
| Local photos | Only if using local storage mode; R2 photos are already in cloud |

---

### Keeping it healthy

```bash
# Full health report
bash ~/fotohaven/infra/android/health-check.sh

# PM2 commands
pm2 status                     # overview
pm2 logs fotohaven             # live logs
pm2 logs fotohaven --lines 50  # last 50 lines
pm2 restart fotohaven          # restart
pm2 monit                      # live CPU/memory dashboard

# Update the app
cd ~/fotohaven
git pull
npm install
npm run db:push
npm run build
pm2 reload fotohaven           # zero-downtime reload
```

---

### Troubleshooting

**App won't start**
```bash
pm2 logs fotohaven --err --lines 50
# Look for: missing env vars, port in use, schema drift
```

**"EACCES: permission denied"**
```bash
termux-setup-storage   # re-request storage permission, tap Allow
```

**cloudflared: "permission denied"**
```bash
chmod +x $PREFIX/bin/cloudflared
```

**Phone keeps killing Termux**
- Settings → Battery → Termux → Unrestricted
- Samsung: Settings → Device Care → Battery → App Power Management → remove Termux

**Next.js build fails (native module errors)**
```bash
npm install --ignore-scripts
# Or install build tools:
pkg install python make clang
```

**Next.js build fails on 'sharp' module load**
Android/Termux uses `android-arm64` which native `sharp` doesn't support. Install the WebAssembly fallback:
```bash
npm install --cpu=wasm32 sharp
npm install @img/sharp-wasm32
```

**Build warning: `face-api.js ... Can't resolve 'encoding'`**
This comes from an optional `node-fetch` path inside `face-api.js` and is not needed for browser inference.
The project now suppresses it via webpack alias/fallback in `next.config.mjs` (`encoding: false`, `fs: false` on client).

**Build warning: `jose ... CompressionStream/DecompressionStream not supported in Edge Runtime`**
This is a known Next.js static-analysis warning path with `jose` webapi modules.
Current auth flow remains functional; treat as warning unless runtime auth endpoints fail.

**Guest OTP not arriving during testing**
If your Resend domain is not verified yet, enable temporary bypass in `.env.local`:
```env
GUEST_OTP_BYPASS="true"
```
Then restart:
```bash
pm2 restart fotohaven --update-env
```
In bypass mode:
- OTP email sending is skipped
- OTP validation is skipped in verify route
- A guest session cookie is still created normally
- Disable this (`false`) before production use

**Port 3000 already in use**
```bash
lsof -i :3000
kill -9 <PID>
pm2 start ecosystem.config.js
```

**App doesn't come back after reboot**
- Check Termux:Boot was opened at least once
- Increase `sleep 10` to `sleep 20` in the boot script if WiFi takes longer to connect
- Verify battery optimisation is disabled

**Schema out of sync after update**
```bash
npm run db:push   # applies any new columns / tables to local.db
```

**Guest face discovery on Termux (sharp / models / processor)**

Use this when setting up or after `git pull` on Android/Termux.

```bash
cd ~/fotohaven
cp local.db "local.db.bak.$(date +%Y%m%d-%H%M%S)"

pkg install -y x11-repo
pkg install -y \
  nodejs-lts python make clang pkg-config ndk-sysroot \
  libc++ glib vips \
  libcairo pango libpixman libjpeg-turbo libpng giflib librsvg freetype fontconfig \
  libx11 libxrender xorgproto

export android_ndk_path="$PREFIX"
export GYP_DEFINES="android_ndk_path=$PREFIX"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig"
export CFLAGS="-I$PREFIX/include"
export CXXFLAGS="-I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib"

npm install

# On Termux, build sharp against global libvips.
unset SHARP_IGNORE_GLOBAL_LIBVIPS
unset npm_config_build_from_source
npm config delete build-from-source 2>/dev/null || true
rm -rf node_modules/sharp
SHARP_FORCE_GLOBAL_LIBVIPS=1 npm install sharp --build-from-source

node -e "const sharp=require('sharp'); console.log('sharp ok', sharp.versions)"
npm run db:push
npx tsc --noEmit
pm2 restart fotohaven --update-env
```

Download all required face-api model files:

```bash
cd ~/fotohaven
mkdir -p public/models

curl -L -o public/models/ssd_mobilenetv1_model-weights_manifest.json https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/ssd_mobilenetv1_model-weights_manifest.json
curl -L -o public/models/ssd_mobilenetv1_model-shard1 https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/ssd_mobilenetv1_model-shard1
curl -L -o public/models/ssd_mobilenetv1_model-shard2 https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/ssd_mobilenetv1_model-shard2

curl -L -o public/models/face_landmark_68_model-weights_manifest.json https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_landmark_68_model-weights_manifest.json
curl -L -o public/models/face_landmark_68_model-shard1 https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_landmark_68_model-shard1

curl -L -o public/models/face_recognition_model-weights_manifest.json https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_recognition_model-weights_manifest.json
curl -L -o public/models/face_recognition_model-shard1 https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_recognition_model-shard1
curl -L -o public/models/face_recognition_model-shard2 https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_recognition_model-shard2

ls -lh public/models
```

If `npm run faces:process` logs `ENOENT` for old photos, those files are missing on disk. Reset processing only for files that exist and skip missing files:

```bash
cd ~/fotohaven
node - <<'JS'
const fs=require('fs');
const path=require('path');
const Database=require('better-sqlite3');
const db=new Database('local.db');
const base=process.env.LOCAL_UPLOAD_PATH || '/data/data/com.termux/files/home/storage/shared/fotohaven';
const rows=db.prepare("SELECT id, storageKey FROM Photo WHERE isReturn=0").all();
const set0=db.prepare("UPDATE Photo SET faceProcessed=0 WHERE id=?");
const set1=db.prepare("UPDATE Photo SET faceProcessed=1 WHERE id=?");
let existing=0, missing=0;
for (const r of rows) {
  const ok = fs.existsSync(path.join(base, r.storageKey));
  (ok ? set0 : set1).run(r.id);
  ok ? existing++ : missing++;
}
console.log({ existing, missing, base });
JS

npm run faces:process
```

To run background processing on a schedule without overlap, use `scripts/process-faces-safe.sh` with PM2 cron:

```bash
chmod +x ~/fotohaven/scripts/process-faces-safe.sh
pm2 start ~/fotohaven/scripts/process-faces-safe.sh --name fotohaven-faces --cron "*/30 * * * *" --no-autorestart
pm2 save
```

Face processor tuning switches (env vars):
- `PROCESS_FACES_SOURCE=auto|thumbnail|original`
  - `auto` (default): thumbnail first, fallback to original
  - `thumbnail`: only thumbnail key
  - `original`: only original key
- `PROCESS_FACES_LIMIT=25` (default) — max photos per run

Example:
```bash
PROCESS_FACES_SOURCE=thumbnail PROCESS_FACES_LIMIT=40 npm run faces:process
```

**Browser-side face descriptor extraction (new default path)**

Use this validation flow after pull/redeploy to verify end-to-end browser processing:

1. Start app and open any album manager page (`/albums/[albumId]`) on laptop/desktop browser.
2. Open browser DevTools Console and confirm:
   - `[FaceProcessor] Loading models from /models...`
   - `[FaceProcessor] Models loaded.`
3. Confirm floating indicator appears at bottom-right:
   - `Processing faces (N/Total)`
4. Keep tab open until at least 10 photos are processed. You should see per-photo logs:
   - `[FaceProcessor] Processed <photoId>: <count> face(s)`
5. Verify DB counters on server:
```bash
node - <<'JS'
const Database=require('better-sqlite3');
const db=new Database('local.db');
const total=db.prepare("select count(*) as c from Photo where isReturn=0").get().c;
const pending=db.prepare("select count(*) as c from Photo where isReturn=0 and faceProcessed=0").get().c;
const faces=db.prepare("select count(*) as c from PhotoFace").get().c;
console.log({ total, pending, faces });
JS
```
6. Verify guest matching still works (`/share/[token]/guest`) with processed photos.

Important implementation detail: face-api.js browser detection must receive `HTMLImageElement`/`HTMLCanvasElement`.
`ImageBitmap` is not a valid net input. In `FaceProcessor`, always draw bitmap to a canvas and run detection on that canvas.
It supports configuring `FACE_SCAN_SOURCE="original"` or `"thumbnail"` in `.env.local` to decide which photo quality to download for scanning. The default is `"original"` for maximum accuracy.

If you see this error in console:
- `toNetInput - expected media to be of type HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | tf.Tensor3D`

Then hard refresh first. If it persists, confirm `src/app/albums/[albumId]/FaceProcessor.tsx` still does:
- `createImageBitmap(blob)` -> draw to `document.createElement('canvas')` -> `detectAllFaces(canvas, ...)`

---

## Standard Setup (PC / VPS)

**Local development:**
```bash
git clone https://github.com/The-kadtan2027/fotohaven.git
cd fotohaven
npm install
cp .env.example .env.local  # fill in DATABASE_URL and optionally R2 credentials
npm run db:push
npm run dev
# → http://localhost:3000
```

**Useful dev commands:**
```bash
npm run db:generate   # generate a new migration from schema changes
npm run db:push       # apply schema to local.db directly (back up production DB first on phone)
npm run db:studio     # open Drizzle Studio GUI for DB browsing
npm run lint
```

Before running schema changes on your phone:
```bash
cd ~/fotohaven
cp local.db "local.db.bak.$(date +%Y%m%d-%H%M%S)"
npm run db:push
```
The Advanced Album Management migration is additive only. It adds:
`Album.compressionQuality`, `Album.compressionFormat`, `Album.dedupThreshold`,
`Photo.isBlurred`, and `Photo.imageHash`.

> **Note on Vercel:** SQLite doesn't work on serverless. For Vercel deployment, switch to a Postgres provider (Neon, Supabase) and update `src/lib/db.ts` to use `drizzle-orm/postgres-js`.

---

## User Flow

**Client (album owner)**
1. Dashboard → all your albums
2. New Album → 3-step form: name + photographer → ceremonies → settings (expiry, password, notify email)
3. Open album → drag photos into ceremony folder → upload
4. Optionally save upload compression defaults and tune duplicate threshold in the album manager
5. Review duplicates, use admin-only blur tools, and preview via progressive lightbox
6. Share Link → copy and send to photographer
7. Receive email when photographer first opens the gallery

**Photographer (share link recipient)**
1. Opens share link — no account needed
2. Enters password if the album is protected
3. Browses gallery organised by ceremony
4. Selects photos (checkbox or "Select All"), adds per-photo notes
5. Downloads ZIP — per ceremony, selected, or everything
6. Uploads edited finals via **Upload Returns** dropzone at the bottom of the page
7. Client sees finals appear in the **Delivered Finals** tab and can download them as a separate ZIP
8. If guest face matching quality changes after an update, use **Reprocess Faces** in the album manager to rebuild descriptors for that album

---

## API Reference

**`POST /api/albums`** — create album
```json
{
  "title": "Sharma Wedding",
  "clientName": "Rahul Mehta Photography",
  "ceremonies": ["Mehndi", "Sangeet", "Wedding"],
  "expiresAt": "2025-06-30",
  "password": "optional-plain-text",
  "notifyEmail": "photographer@example.com"
}
```

**`GET /api/albums`** — list all albums with counts

**`GET /api/albums/:albumId`** — full album with photos and presigned URLs

**`PATCH /api/albums/:albumId`** — save album defaults
```json
{ "compressionFormat": "webp", "compressionQuality": 80, "dedupThreshold": 10 }
```

**`DELETE /api/albums/:albumId`** — delete album and cascade all data

**`POST /api/upload`** — get presigned upload URL (admin use)
```json
{ "ceremonyId": "uuid", "filename": "DSC_0042.jpg", "contentType": "image/jpeg", "size": 8420000 }
```
Returns `{ photoId, uploadUrl, storageKey }` — client PUTs file directly to `uploadUrl`.

**`GET /api/share/:token`** — photographer/client gallery view.
- Returns `401 { passwordRequired: true }` if album is password-protected and no `Authorization: Bearer <pass>` header was sent.
- Sets `firstViewedAt` and triggers Resend notification on first successful load.
- Returns `410` if link has expired.

**`POST /api/share/:token/upload`** — photographer uploads finals (no account required)
```json
{ "ceremonyId": "uuid", "filename": "edited_DSC_0042.jpg", "contentType": "image/jpeg", "size": 9100000 }
```
Creates a photo record with `isReturn: true`. Returns same presigned URL flow as `/api/upload`.

**`GET /api/comments?photoId=uuid`** — list comments for a photo

**`POST /api/comments`** — add a comment
```json
{ "photoId": "uuid", "body": "Please crop tighter on the left", "author": "photographer" }
```

**`POST /api/albums/:albumId/reprocess-faces`** — clear saved face descriptors for an album and mark its original photos for reprocessing on the next album-manager visit

Guest face discovery notes:
- matching now uses Euclidean distance on `face-api.js` descriptors
- current threshold is `0.5`
- UI labels use `< 0.42` = `Strong match`, `0.42–0.5` = `Possible match`

**`POST /api/photos/blur-batch`** — bulk toggle admin blur
```json
{ "photoIds": ["uuid-1", "uuid-2"], "isBlurred": true }
```

---

## Roadmap

- [x] Per-photo comments — photographer and client annotate photos in the gallery
- [x] Password-protected share links — bcrypt-hashed, challenge screen on the client side
- [x] Email notifications — first-view alert via Resend
- [x] Upload-back flow — photographer delivers edited finals; client downloads from separate tab
- [ ] Health dashboard — phone stats (CPU, RAM, disk, tunnel status) at `/admin/health`
- [ ] WhatsApp notifications via Twilio/WATI
- [ ] AI duplicate detection before upload
- [x] Thumbnail previews — low-res gallery, full-res on download
- [ ] Print ordering — Canvera / Zoomin for Indian photo labs
- [ ] Two-phone redundancy — run on backup phone for uptime

---

## License

MIT — build on it, ship it, make it yours.
