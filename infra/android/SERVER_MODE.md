# Android server mode — FotoHaven phone

Applied: 2026-11-14 21:35 IST
Device: `M2101K6I` (OPPO/Realme-class, arm64), Android 16, KernelSU root
Termux: 0.119.0-beta.3 (F-Droid), `u0_a372`
Host: `192.168.1.5`, SSH `8022` (Termux sshd), wireless debugging `38687`
App: `/data/data/com.termux/files/home/fotohaven`, Next.js on `:3000`, native face service `:5080`
Public entry: Cloudflare named tunnel → `https://fotohaven.live` (Tailscale peer is offline)

## Safety / backups

Everything is in:

```
/data/data/com.termux/files/home/fotohaven-backups/20261114-212222/
```

| Item | Detail |
|---|---|
| `local.db` | SQLite `.backup` taken before changes (31 MB, `PRAGMA integrity_check` = ok) |
| `local.db.after` | Post-change backup (31 MB, integrity ok) |
| `uploads/` | Full copy of `/storage/shared/fotohaven-uploads` — **9630 files, 1.2 GB**, sample SHA-256 pairs matched |
| `uploads-manifest.tsv.gz` | Path + size for all 9630 upload files |
| `config.tar.gz` | `.env.local`, `ecosystem.config.js`, `.env` |
| `boot/` | Original Termux:Boot scripts before changes |
| `ecosystem.config.js.pre-server-mode` | Prior PM2 config |
| `dump.pm2*` | PM2 process list before/after |
| `restore-disabled-apps.sh` | Re-enables every app/background restriction applied below |

**No uploaded photo or thumbnail was deleted or modified.** Upload count/size was `9630 / 1.2G` before and after.

## What changed

### Runtime / liveness
- Termux partial wake lock is held (`termux:service-wakelock`).
- Termux and Termux:Boot are in the device-idle whitelist and active standby bucket.
- Phantom-process killer disabled (`max_phantom_processes=2147483647`).
- `RUN_IN_BACKGROUND` / `RUN_ANY_IN_BACKGROUND` allowed for Termux.
- Doze state observed `ACTIVE` with screen off; no forced Doze disable needed.
- `~/.termux/boot/start-pm2` added: `termux-wake-lock`, wait 20 s, `pm2 resurrect`.
  Tested live with `pm2 kill` → script → all three apps returned online, `:3000` = 307.
- `~/.termux/boot/zz-server-tuning.sh` added and run: sysctls, read-ahead, phantom/standby/appops, Bluetooth off, animations off.
- PM2 `pm2 save` run; `pm2-logrotate` installed (`10M`, retain 5, daily, compress).

### Resources / kernel
- `vm.vfs_cache_pressure=50`, `vm.min_free_kbytes=65536`
- `net.core.somaxconn=1024`, `net.ipv4.tcp_keepalive_time=300`, `tcp_slow_start_after_idle=0`
- `read_ahead_kb=2048` on `dm-*` (main `/data` device `dm-41`)
- PM2 `fotohaven`: heap `1024M` (was 768M), `max_memory_restart=1280M`, `kill_timeout=10s`
- PM2 `native-face-service`: `max_memory_restart=768M`
- Removed `--optimize-for-size` (it trades speed for memory; the phone has 2.2 GB available)

### Disabled apps (reversible)
Disabled user packages:
- `com.google.android.googlequicksearchbox` (Google app; was ~600 MB across processes)
- `com.google.android.apps.wellbeing`
- `com.google.ar.core`
- `android.autoinstalls.config.Xiaomi.model`

Background restricted (`appops RUN_IN_BACKGROUND=ignore`):
- `com.android.vending` (Play Store)
- `com.android.chrome`
- `app.morphe.android.youtube`
- `app.morphe.android.youtube.music`
- `idm.internet.download.manager.plus`
- `com.microsoft.office.onenote`

Not touched: `com.google.android.gms`, phone/SMS, Telegram, KernelSU, Termux, launchers, system UI.

### Radios / UI
- Bluetooth off, Wi-Fi stays on (`wifi_sleep_policy=2`), mobile data untouched.
- Animations off, auto-rotate off, screen timeout 30 s.
- `pm trim-caches 32G`, `am kill-all` run.
- Cleaned 918 MB npm cache, node-gyp/pip caches, old PM2 logs (106 MB → 28 KB), Termux package cache.

## Verification (run on device)

| Check | Result |
|---|---|
| `sqlite3 local.db "PRAGMA integrity_check;"` | `ok` |
| Uploads count / size | `9630` / `1.2G` (unchanged) |
| `curl -I http://127.0.0.1:3000/api/share/<token>` | `200` |
| Ceremony photos API (839 photos) | `200`, first thumbnail `200 image/jpeg 53150` |
| ZIP download (one photo) | `200`, 81 KB zip |
| `https://fotohaven.live/` from laptop | `307` in ~0.8 s |
| PM2 | cloudflared / fotohaven / native-face-service online; logrotate online |
| Free RAM after cleanup | ~2.2 GB available (was ~2.1 GB; Google app 600 MB freed, Play re-cached) |
| Doze | `mState=ACTIVE`, wake lock held, AC powered, 34 °C |

## Restore

```sh
# apps and background restrictions
sh ~/fotohaven-backups/20261114-212222/restore-disabled-apps.sh

# prior PM2 config (then restart)
cp ~/fotohaven-backups/20261114-212222/ecosystem.config.js.pre-server-mode ~/fotohaven/ecosystem.config.js
pm2 restart ecosystem.config.js --only fotohaven --update-env

# boot scripts
rm -f ~/.termux/boot/start-pm2 ~/.termux/boot/zz-server-tuning.sh
```

Data restore, if ever needed: stop PM2, restore `local.db` from `local.db.after` (or `local.db`), restore `uploads/` with `cp -a`, `pm2 resurrect`.

## Caveats

- **No physical reboot was performed.** The PM2 resurrect path was tested by killing PM2, and every boot script passes `sh -n`; a real reboot is the final proof. Termux:Boot and Termux are installed, enabled, and whitelisted.
- Disabling the Google app removes Assistant/Google search/At-a-Glance-style features on the phone. Re-enable with the restore script if needed.
- Play Store background updates may be delayed while `RUN_IN_BACKGROUND=ignore`; opening Play Store still works.
- The pm2-logrotate module adds ~30–60 MB RSS; it replaced 106 MB of unmanaged logs.
- The PM2 heap/limit change is in the device-local `ecosystem.config.js`. A `git pull`/`git checkout` on the phone can overwrite it; re-apply the two lines or merge them into the repo copy before redeploying.
- The backup copy doubles upload storage while it exists (1.2 GB). It is on the same device; copy it off-device for disaster recovery.
- Tailscale is offline (`oppo-reno14-pro-5g`, last seen 1 day); Cloudflare is the active public path.
