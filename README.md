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
- **Photographer gallery** — browse by ceremony, lightbox preview, select individual photos
- **Bulk ZIP download** — per-ceremony or everything, generated in the browser

---

## Tech Stack

| Layer      | Choice                       | Why                                                   |
|------------|------------------------------|-------------------------------------------------------|
| Framework  | Next.js 14 (App Router)      | API routes + React UI in one repo                     |
| Database   | SQLite via Prisma            | Single file, zero config, perfect for a phone         |
| Storage    | Cloudflare R2 or local disk  | R2 for cloud; phone SD card for fully-offline hosting |
| Process    | PM2                          | Keeps Node alive, restarts on crash, survives reboots |
| Tunnel     | Cloudflare Tunnel            | Public URL without port-forwarding or static IP       |
| Fonts      | Cormorant Garamond + DM Sans | Luxury editorial aesthetic                            |

---

## Project Structure

```
fotohaven/
├── prisma/
│   └── schema.prisma              # Album, Ceremony, Photo models
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx               # Dashboard
│   │   ├── albums/
│   │   │   ├── new/page.tsx       # Create album (3-step form)
│   │   │   └── [albumId]/page.tsx # Album manager + uploader
│   │   ├── share/[token]/page.tsx # Photographer gallery + download
│   │   └── api/
│   │       ├── albums/route.ts
│   │       ├── albums/[albumId]/route.ts
│   │       ├── upload/route.ts
│   │       └── share/[token]/route.ts
│   ├── lib/
│   │   ├── db.ts                  # Prisma singleton
│   │   └── storage.ts             # R2/S3 abstraction
│   └── types/index.ts
├── infra/
│   └── android/
│       ├── termux-setup.sh        # One-shot bootstrap script
│       ├── cloudflared-config.yml # Cloudflare Tunnel config
│       ├── health-check.sh        # Server status checker
│       ├── backup.sh              # DB + photo backup
│       └── local-storage-adapter.ts  # Swap R2 for phone disk
├── ecosystem.config.js            # PM2 process config
├── .env.example
└── package.json
```

---

## Hosting Options

| Option                   | Cost           | Difficulty | Best for                                |
|--------------------------|----------------|------------|-----------------------------------------|
| **Android phone** (this guide) | ₹0       | Medium     | Learning, personal use, always-on home server |
| Vercel + Neon            | Free → ~₹1600/mo | Easy     | Production, public-facing               |
| VPS (Hetzner)            | ~₹500/mo       | Medium     | Production with full control            |
| Raspberry Pi             | One-time ~₹3000 | Medium    | Dedicated home server                   |

---

## Android Phone Hosting Guide

Your old Android phone is a capable ARM Linux machine:
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
curl -fsSL https://raw.githubusercontent.com/yourname/fotohaven/main/infra/android/termux-setup.sh | bash
```

The script installs: `nodejs`, `git`, `curl`, `wget`, `openssh`, `pm2`, `cloudflared` (ARM64), requests storage permission, installs npm deps, runs Prisma, builds Next.js, and sets up the reboot boot script.

> To do it manually step-by-step, read `infra/android/termux-setup.sh` — every command is documented inline.

---

### Step 3 — Get the code on the phone

**Option A — Git clone (easiest)**

```bash
cd ~
git clone https://github.com/yourname/fotohaven.git
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
# Database — SQLite file on the phone
DATABASE_URL="file:./prisma/dev.db"

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

# Swap storage adapter:
cp infra/android/local-storage-adapter.ts src/lib/storage.ts
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

# Initialise the database
npx prisma generate
npx prisma db push

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

### Step 7 — Expose to the internet (Cloudflare Tunnel)

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

> **Quick test with no domain:** `cloudflared tunnel --url http://localhost:3000`
> Instantly prints a `*.trycloudflare.com` URL — share it and it works immediately.

---

### Step 8 — Auto-start on reboot

**8a — Save PM2 state**
```bash
pm2 save
```

**8b — Activate Termux:Boot**

Open the **Termux:Boot** app once (just launch and close it). This registers the boot trigger.

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
| SQLite database | `prisma/dev.db` — all albums, ceremonies, photo metadata |
| `.env.local` | Config + secrets (encrypted if `BACKUP_PASSWORD` is set) |
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
npx prisma db push
npm run build
pm2 reload fotohaven           # zero-downtime reload
```

---

### Troubleshooting

**App won't start**
```bash
pm2 logs fotohaven --err --lines 50
# Look for: missing env vars, port in use, Prisma errors
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

---

## Standard Setup (PC / VPS)

**Local development:**
```bash
git clone https://github.com/yourname/fotohaven.git
cd fotohaven
npm install
cp .env.example .env.local  # fill in R2 credentials
npm run db:push
npm run db:generate
npm run dev
# → http://localhost:3000
```

**Deploy to Vercel:**
```bash
npm i -g vercel
vercel
# Add env vars in Vercel dashboard → Settings → Environment Variables
```

Switch SQLite to Postgres for Vercel (SQLite doesn't work on serverless):
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```
Use [Neon](https://neon.tech) or [Supabase](https://supabase.com) — both have free tiers.

---

## User Flow

**Client (you)**
1. Dashboard → all your albums
2. New Album → 3-step form: name + photographer → ceremonies → expiry
3. Open album → drag photos into ceremony folder → upload
4. Share Link → send URL to photographer

**Photographer**
1. Opens share link — no account needed
2. Browses gallery organised by ceremony
3. Selects photos (checkbox or "Select All")
4. Downloads ZIP — per ceremony or everything

---

## API Reference

**`POST /api/albums`** — create album
```json
{ "title": "Sharma Wedding", "clientName": "Rahul Mehta Photography",
  "ceremonies": ["Mehndi", "Sangeet", "Wedding"], "expiresAt": "2025-06-30" }
```

**`GET /api/albums`** — list all albums with counts

**`GET /api/albums/:albumId`** — full album with photos and presigned URLs

**`POST /api/upload`** — get presigned upload URL
```json
{ "ceremonyId": "uuid", "filename": "DSC_0042.jpg",
  "contentType": "image/jpeg", "size": 8420000 }
```
Returns `{ photoId, uploadUrl, storageKey }` — client PUTs file directly to `uploadUrl`.

**`GET /api/share/:token`** — photographer view. Returns `410` if expired.

---

## Roadmap

- [ ] Per-photo comments — photographer annotates photos in the gallery
- [ ] Upload-back flow — photographer delivers edited finals into the same album
- [ ] Password-protected links
- [ ] Email notifications via Resend
- [ ] WhatsApp notifications via Twilio/WATI
- [ ] AI duplicate detection before upload
- [ ] Watermarked previews — low-res gallery, full-res on download
- [ ] Health dashboard — phone stats + tunnel status in a browser tab
- [ ] Print ordering — Canvera / Zoomin for Indian photo labs
- [ ] Two-phone redundancy — run on backup phone for uptime

---

## License

MIT — build on it, ship it, make it yours.
