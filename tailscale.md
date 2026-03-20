# FotoHaven Migration Plan: Termux → Ubuntu 24.04 (Proot-distro)

Alright, proceeding with **proot-distro** — the safe, sensible choice for your use case.

This plan preserves all the benefits (Ubuntu, glibc, clean environment) while eliminating the phone-bricking risks.

---

## Pre-Migration Checklist

Before we start, let's verify a few things and back up critical data.

### Step 0: Backup Critical Data

```bash
# From Termux, backup the database and uploads
cd ~/fotohaven
tar -czf fotohaven-backup-$(date +%Y%m%d).tar.gz local.db data/uploads .env.local

# Move backup to safe location (sdcard)
mv fotohaven-backup-*.tar.gz /sdcard/Download/

# Verify backup exists
ls -lh /sdcard/Download/fotohaven-backup-*
```

**Verification:** You should see a `.tar.gz` file with today's date, size should be reasonable (depends on your uploads).

---

## Phase 1: Install Proot-distro and Ubuntu

### Step 1.1: Install proot-distro

```bash
# Update Termux packages first
pkg update && pkg upgrade -y

# Install proot-distro
pkg install -y proot-distro
```

**Expected output:**
```
Installing proot-distro...
Setting up proot-distro (4.x.x)...
```

**Verify:**
```bash
proot-distro --version
# Should show version info
```

### Step 1.2: Install Ubuntu 24.04

```bash
# List available distributions (optional, to see what's available)
proot-distro list

# Install Ubuntu 24.04 (alias: ubuntu)
proot-distro install ubuntu
```

**Expected output:**
```
[*] Downloading rootfs...
ubuntu-24.04-arm64.tar.xz: 100% [================] 
[*] Extracting rootfs...
[*] Installation complete.
```

**This takes:** 3-5 minutes depending on your connection.

**Disk space used:** ~500MB for base Ubuntu rootfs.

### Step 1.3: Enter Ubuntu for the First Time

```bash
proot-distro login ubuntu
```

**Expected output:**
```
root@localhost:~# 
```

**You're now inside Ubuntu!** Notice the prompt changed.

---

## Phase 2: Initial Ubuntu Configuration

### Step 2.1: Update Package Lists and Fix DNS

Still inside Ubuntu proot:

```bash
# First, check if DNS works
ping -c 2 8.8.8.8

# If ping works but apt doesn't, fix DNS:
echo "nameserver 8.8.8.8" > /etc/resolv.conf
echo "nameserver 1.1.1.1" >> /etc/resolv.conf

# Make it immutable (prevent apt from overwriting)
chattr +i /etc/resolv.conf

# Now update package lists
apt update
```

**Expected output:**
```
Get:1 http://ports.ubuntu.com/ubuntu-ports noble InRelease [...]
Get:2 http://ports.ubuntu.com/ubuntu-ports noble-updates InRelease [...]
Reading package lists... Done
```

**If you see errors:** It's likely DNS. Double-check `/etc/resolv.conf` has the nameservers.

### Step 2.2: Set Locale and Timezone

```bash
# Install locales package
apt install -y locales tzdata

# Generate locale
locale-gen en_US.UTF-8

# Set timezone (adjust to your location)
ln -sf /usr/share/zoneinfo/Asia/Kolkata /etc/localtime
dpkg-reconfigure -f noninteractive tzdata

# Verify
date
```

---

## Phase 3: Install Dependencies

### Step 3.1: Install Node.js 20.x from NodeSource

Still inside Ubuntu proot:

```bash
# Install prerequisites
apt install -y curl ca-certificates gnupg

# Add NodeSource repository for Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

# Install Node.js and npm
apt install -y nodejs

# Verify installation
node --version   # Should show v20.x.x
npm --version    # Should show v10.x.x
```

**Expected versions:**
- Node.js: v20.11.0 or newer
- npm: v10.2.0 or newer

**If curl fails with SSL errors:**
```bash
apt install -y ca-certificates
update-ca-certificates
```

### Step 3.2: Install Build Tools

```bash
# Essential for compiling native Node modules
apt install -y build-essential python3 git pkg-config

# Verify gcc is installed
gcc --version   # Should show gcc 13.x (Ubuntu 24.04 default)
```

### Step 3.3: Install Tailscale

```bash
# Add Tailscale's package signing key and repository
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null

curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list | tee /etc/apt/sources.list.d/tailscale.list

# Update package lists
apt update

# Install Tailscale
apt install -y tailscale

# Verify installation
tailscale version
```

**Expected output:**
```
tailscale version 1.xx.x
```

### Step 3.4: Install PM2 Globally

```bash
# Install PM2 as global npm package
npm install -g pm2

# Verify installation
pm2 --version
which pm2   # Should show /usr/bin/pm2 or similar
```

---

## Phase 4: Code Migration

### Step 4.1: Copy FotoHaven from Termux to Ubuntu

**Exit Ubuntu proot first:**
```bash
exit   # Returns you to Termux
```

**Now from Termux, copy the project:**

```bash
# Copy entire fotohaven directory into proot's /root
cp -r ~/fotohaven ~/.local/share/proot-distro/installed-rootfs/ubuntu/root/

# Verify copy succeeded
ls -lh ~/.local/share/proot-distro/installed-rootfs/ubuntu/root/fotohaven/
```

**You should see:** All your project files, including `local.db`, `data/`, `.env.local`, etc.

### Step 4.2: Enter Ubuntu and Clean Up Termux Artifacts

```bash
# Re-enter Ubuntu proot
proot-distro login ubuntu

# Navigate to project
cd /root/fotohaven

# Delete Termux-specific artifacts
rm -rf node_modules/
rm -rf .next/
rm -rf drizzle/
rm -f prisma-android-fix.js

# Check if prisma-alpine-patch.sh exists and remove it
rm -f infra/android/prisma-alpine-patch.sh

# List what remains
ls -la
```

**You should still see:**
- `src/`
- `package.json`, `package-lock.json`
- `.env.local`
- `local.db`
- `data/uploads/` (with your existing photos)
- Other config files

### Step 4.3: Remove Termux-Specific Workarounds

**Edit `next.config.mjs`:**

```bash
# Open in a text editor (nano is usually pre-installed)
apt install -y nano
nano next.config.mjs
```

**Find this line:**
```javascript
transpilePackages: ['lucide-react'],
```

**Delete it completely.** The file should look like:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // transpilePackages: ['lucide-react'], ← REMOVED
};

export default nextConfig;
```

**Save and exit:** `Ctrl+X`, then `Y`, then `Enter`

**Edit `package.json`:**

```bash
nano package.json
```

**Find the `scripts` section and remove the `postinstall` line if it exists:**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    // "postinstall": "node prisma-android-fix.js"  ← DELETE THIS LINE IF PRESENT
  }
}
```

**Save and exit.**

### Step 4.4: Update Path in `.env.local`

```bash
nano .env.local
```

**Find and update `LOCAL_UPLOAD_PATH`:**

```bash
# BEFORE (Termux path):
# LOCAL_UPLOAD_PATH=/data/data/com.termux/files/home/fotohaven/data/uploads

# AFTER (Ubuntu proot path):
LOCAL_UPLOAD_PATH=/root/fotohaven/data/uploads
```

**Leave everything else unchanged** (especially `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY`, etc.)

**Save and exit.**

---

## Phase 5: Install Dependencies and Build

### Step 5.1: Fresh npm install

Still in `/root/fotohaven` inside Ubuntu:

```bash
# Install all dependencies (this compiles native modules for glibc)
npm install
```

**Expected output:**
```
npm WARN deprecated ...
added 500 packages in 2m

> better-sqlite3@12.8.0 install /root/fotohaven/node_modules/better-sqlite3
> node-gyp rebuild

  CC(target) Release/obj.target/better_sqlite3/...
  ...
```

**Watch for:** `better-sqlite3` compilation output. This confirms it's building native bindings for ARM64 glibc.

**This takes:** 3-5 minutes depending on phone CPU.

**If you see errors about Python or gcc:** Go back to Step 3.2 and ensure build tools are installed.

### Step 5.2: Verify Database Connection

```bash
# Run Drizzle push to sync schema (should be no-op if schema unchanged)
npm run db:push
```

**Expected output:**
```
No schema changes detected
```

**If you see errors:**
```
Error: Cannot find module 'better-sqlite3'
```
→ The native module didn't compile. Check Step 5.1 output for compilation errors.

### Step 5.3: Build Next.js App

```bash
npm run build
```

**Expected output:**
```
> fotohaven@1.0.0 build
> next build

   ▲ Next.js 15.1.4

   Creating an optimized production build ...
   ✓ Compiled successfully
   ...
   Route (app)                              Size     First Load JS
   ┌ ○ /                                    ...      ...
   └ ○ /share/[token]                       ...      ...
```

**This takes:** 1-2 minutes.

**If build fails with memory errors:**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=2048"
npm run build
```

### Step 5.4: Quick Test (Dev Mode)

```bash
# Start in development mode to verify everything works
npm run dev
```

**Expected output:**
```
> fotohaven@1.0.0 dev
> next dev

  ▲ Next.js 15.1.4
  - Local:        http://localhost:3000
  - Ready in 2.3s
```

**Press `Ctrl+C` to stop** after you see "Ready in X.Xs".

**Don't test in browser yet** — we haven't set up Tailscale tunnel.

---

## Phase 6: Configure PM2 with Tailscale

### Step 6.1: Update PM2 Config to Include Tailscale Daemon

```bash
nano ecosystem.config.js
```

**Replace entire file with:**

```javascript
module.exports = {
  apps: [
    {
      name: 'tailscaled',
      script: '/usr/sbin/tailscaled',
      args: '--tun=userspace-networking --state=/var/lib/tailscale/tailscaled.state',
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s',
    },
    {
      name: 'fotohaven',
      script: 'npm',
      args: 'start',
      cwd: '/root/fotohaven',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
    }
  ]
};
```

**Save and exit.**

### Step 6.2: Start Tailscale Daemon via PM2

```bash
# Start only tailscaled first
pm2 start ecosystem.config.js --only tailscaled

# Check status
pm2 status
```

**Expected output:**
```
┌─────┬───────────────┬─────────┬─────────┬─────────┬──────────┐
│ id  │ name          │ status  │ restart │ uptime  │ cpu      │
├─────┼───────────────┼─────────┼─────────┼─────────┼──────────┤
│ 0   │ tailscaled    │ online  │ 0       │ 3s      │ 0%       │
└─────┴───────────────┴─────────┴─────────┴─────────┴──────────┘
```

**If status is "errored":**
```bash
pm2 logs tailscaled
# Look for error messages about missing directories
```

**Common fix:**
```bash
mkdir -p /var/lib/tailscale
pm2 restart tailscaled
```

### Step 6.3: Authenticate Tailscale

```bash
# Connect to your Tailscale account
tailscale up
```

**Expected output:**
```
To authenticate, visit:

  https://login.tailscale.com/a/xxxxxxxxxxxxxx

Success.
```

**What to do:**
1. Copy the URL
2. Open it in your phone's browser (or any browser)
3. Log in to your Tailscale account
4. Approve the device

**After approval:**
```bash
# Verify connection
tailscale status
```

**You should see:**
```
100.x.x.x   your-phone-name    youraccount@    linux   -
```

### Step 6.4: Enable Tailscale Funnel

```bash
# Enable funnel on port 3000
tailscale funnel 3000
```

**Expected output:**
```
Available on the internet:

https://your-phone-name.tail-scale.ts.net/

Press Ctrl+C to exit.
```

**DON'T press Ctrl+C yet!** Open a new Termux session.

**In the new Termux session:**
```bash
# Enter Ubuntu proot again
proot-distro login ubuntu

# Check funnel status
tailscale funnel status
```

**You should see:**
```
https://your-phone-name.tail-scale.ts.net (Funnel on)
  |-- / proxy http://127.0.0.1:3000
```

**Now go back to the first session and press Ctrl+C.**

**Funnel configuration is saved** — it persists even after stopping the command.

### Step 6.5: Update .env.local with Funnel URL

```bash
# Copy your Funnel URL from the output above
nano .env.local
```

**Update `NEXT_PUBLIC_APP_URL`:**
```bash
NEXT_PUBLIC_APP_URL=https://your-phone-name.tail-scale.ts.net
```

**Save and exit.**

### Step 6.6: Start FotoHaven via PM2

```bash
cd /root/fotohaven

# Start the app
pm2 start ecosystem.config.js --only fotohaven

# Check status
pm2 status
```

**Expected output:**
```
┌─────┬───────────────┬─────────┬─────────┬─────────┬──────────┐
│ id  │ name          │ status  │ restart │ uptime  │ cpu      │
├─────┼───────────────┼─────────┼─────────┼─────────┼──────────┤
│ 0   │ tailscaled    │ online  │ 0       │ 5m      │ 0%       │
│ 1   │ fotohaven     │ online  │ 0       │ 10s     │ 15%      │
└─────┴───────────────┴─────────┴─────────┴─────────┴──────────┘
```

**View logs:**
```bash
pm2 logs fotohaven --lines 20
```

**You should see:**
```
  ▲ Next.js 15.1.4
  - Local:        http://localhost:3000
  - Ready in 1.5s
```

### Step 6.7: Test Access from Internet

**On your phone or any device:**

1. Open browser
2. Go to: `https://your-phone-name.tail-scale.ts.net`
3. You should see FotoHaven homepage

**If it loads successfully: ✅ Migration is working!**

### Step 6.8: Save PM2 Process List

```bash
# Save current process list for resurrection after reboot
pm2 save
```

**Expected output:**
```
[PM2] Saving current process list...
[PM2] Successfully saved in /root/.pm2/dump.pm2
```

---

## Phase 7: Auto-Start on Phone Reboot

### Step 7.1: Create Ubuntu Startup Script

```bash
# Still inside Ubuntu proot
nano /root/start-fotohaven.sh
```

**Paste this content:**

```bash
#!/bin/bash
# FotoHaven startup script for proot-distro

# Wait for network (proot might start before Android network is ready)
sleep 5

# Navigate to project directory
cd /root/fotohaven

# Resurrect PM2 processes (tailscaled + fotohaven)
pm2 resurrect

# Show status
pm2 status

# Keep logs visible (optional, comment out if you don't want logs in console)
pm2 logs --lines 50
```

**Save and exit.**

**Make executable:**
```bash
chmod +x /root/start-fotohaven.sh
```

### Step 7.2: Exit Ubuntu and Create Termux Boot Script

```bash
# Exit Ubuntu proot
exit
```

**Now in Termux:**

```bash
# Create boot directory if it doesn't exist
mkdir -p ~/.termux/boot

# Create boot script
nano ~/.termux/boot/start-fotohaven.sh
```

**Paste this content:**

```bash
#!/data/data/com.termux/files/usr/bin/bash

# Wait for Termux to fully initialize
sleep 10

# Enter proot-distro and run startup script
proot-distro login ubuntu -- /root/start-fotohaven.sh &
```

**Save and exit.**

**Make executable:**
```bash
chmod +x ~/.termux/boot/start-fotohaven.sh
```

### Step 7.3: Install Termux:Boot (if not already installed)

```bash
# Check if Termux:Boot is installed
pm list packages | grep termux.boot
```

**If not installed:**
1. Open F-Droid app on your phone
2. Search for "Termux:Boot"
3. Install it
4. Open Termux:Boot app once (this grants it necessary permissions)

**Or install via pkg:**
```bash
pkg install termux-boot
```

### Step 7.4: Test Boot Script Manually (Don't Reboot Yet)

```bash
# Test the boot script
~/.termux/boot/start-fotohaven.sh
```

**Expected behavior:**
- Script enters Ubuntu proot
- PM2 resurrects processes
- You see PM2 status and logs

**If you see errors:**
- Check that PM2 was saved (`pm2 save` in Step 6.8)
- Check that `/root/start-fotohaven.sh` is executable inside proot

**Stop the test:**
```bash
# Enter proot
proot-distro login ubuntu

# Stop PM2 processes
pm2 stop all

# Exit
exit
```

---

## Phase 8: Final Verification and Cleanup

### Step 8.1: Reboot Phone (Real Test)

**Before rebooting:**
1. Make sure PM2 processes are running: `proot-distro login ubuntu`, then `pm2 status`
2. Make sure `pm2 save` was run
3. Make sure Termux:Boot script is in `~/.termux/boot/`

**Reboot your phone:**
- Hold power button → Restart

**After reboot:**
1. Wait 1-2 minutes (boot script has `sleep 10` + `sleep 5`)
2. Open Termux app
3. Check if proot is running:

```bash
ps aux | grep proot
# Should see proot-distro process
```

4. Enter Ubuntu and check PM2:

```bash
proot-distro login ubuntu
pm2 status
```

**Expected output:**
```
┌─────┬───────────────┬─────────┬─────────┬─────────┐
│ id  │ name          │ status  │ restart │ uptime  │
├─────┼───────────────┼─────────┼─────────┼─────────┤
│ 0   │ tailscaled    │ online  │ 0       │ 30s     │
│ 1   │ fotohaven     │ online  │ 0       │ 25s     │
└─────┴───────────────┴─────────┴─────────┴─────────┘
```

5. Test internet access:
   - Go to `https://your-phone-name.tail-scale.ts.net`
   - Should load FotoHaven

**If everything works: ✅ Migration complete!**

### Step 8.2: Optional Cleanup (Delete Termux FotoHaven)

**Only do this after confirming Ubuntu version works perfectly for a few days.**

```bash
# From Termux (outside proot):
rm -rf ~/fotohaven

# This frees up ~300-500MB
```

**Keep the backup on /sdcard just in case:**
```bash
ls -lh /sdcard/Download/fotohaven-backup-*
```

---

## Troubleshooting Common Issues

### Issue: PM2 doesn't resurrect after reboot

**Symptom:** `pm2 status` shows "No process found"

**Fix:**
```bash
# Check if dump file exists
ls -la /root/.pm2/dump.pm2

# If missing, manually start and save:
cd /root/fotohaven
pm2 start ecosystem.config.js
pm2 save
```

### Issue: Tailscale Funnel is not active after reboot

**Symptom:** App works on `localhost:3000` but not on Funnel URL

**Fix:**
```bash
tailscale funnel status
# If shows "Funnel: off"

tailscale funnel 3000
# Wait for "Available on the internet" message
# Press Ctrl+C (Funnel stays enabled)
```

### Issue: DNS resolution fails inside proot

**Symptom:** `apt update` fails, `npm install` fails with network errors

**Fix:**
```bash
# Inside Ubuntu proot:
echo "nameserver 8.8.8.8" > /etc/resolv.conf
chattr +i /etc/resolv.conf

# Test:
ping -c 2 google.com
```

### Issue: "Cannot find module 'better-sqlite3'"

**Symptom:** App crashes on start with module not found error

**Fix:**
```bash
cd /root/fotohaven
rm -rf node_modules/
npm install
pm2 restart fotohaven
```

### Issue: Boot script doesn't run

**Symptom:** After reboot, proot isn't running

**Fix:**
```bash
# Check if Termux:Boot has permission:
# Settings → Apps → Termux:Boot → Permissions
# Ensure "Run in background" is allowed

# Check if script is executable:
ls -la ~/.termux/boot/start-fotohaven.sh
# Should show -rwxr-xr-x

# If not:
chmod +x ~/.termux/boot/start-fotohaven.sh
```

---

## Summary: What We Achieved

✅ **Ubuntu 24.04 LTS environment** running inside proot-distro  
✅ **No phone-bricking risks** (all userspace, no kernel modifications)  
✅ **Native glibc binaries** (better-sqlite3 compiled natively)  
✅ **Removed all Termux workarounds** (transpilePackages, prisma-fix, etc.)  
✅ **PM2 managing both Tailscale and app** (unified process management)  
✅ **Tailscale Funnel for public access** (persistent HTTPS URL)  
✅ **Auto-start on phone reboot** (via Termux:Boot → proot-distro → PM2)  
✅ **Clean separation** (Termux and Ubuntu don't interfere with each other)

---

## What to do next?

Let me know:
1. Which phase you're on
2. Any errors you encounter (paste full error output)
3. When you've successfully accessed the app from the Funnel URL

I'll help debug any issues that come up during execution.