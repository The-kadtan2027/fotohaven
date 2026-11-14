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
- `~/.termux/boot/start-runit` added: starts `runsvdir` only if absent.
- `~/.termux/boot/zz-server-tuning.sh` added and run: sysctls, read-ahead, slow charging, phantom/standby/appops, Bluetooth off, animations off.
- PM2 `pm2 save` run; `pm2-logrotate` installed (`10M`, retain 5, daily, compress).

### Battery care (charge limiter)
- `charge-limit` runit service: **stop at 80%**, **resume at 75%**, 30 s poll.
- `slowly_charging=1` is enforced whenever charging; Qualcomm SMB5 drops the
  constant charge current from ~3.6 A to ~1 A, reducing heat and stress.
- Thermal guard: stops charging at ≥42.0 °C; will not resume until ≤38.0 °C
  and at/below the resume SoC.
- At setup time the phone was at 96%, so it stopped immediately and will
  discharge to 75% before charging back to 80%. This is intentional.
- Android may still display “Charging” after the limit stops it; the SMB5
  `status` node is stale. `battery_charging_enabled=0` plus positive
  `current_now` is the authoritative stopped state.
- Log: `~/charge-limit.log`; transitions only (STOP / RESUME / SLOW_CHARGE / errors).
- Stop charging does **not** create a true power bypass: with USB connected,
  `battery_charging_enabled=0` leaves the phone running mostly from the battery
  (~60 mA idle). It is a charge-cycle limiter, not a load bypass.
- To take a full charge for travel: `sv down charge-limit`, then
  `su -c 'echo 1 > /sys/class/power_supply/battery/battery_charging_enabled'`
  and `su -c 'echo 0 > /sys/class/power_supply/battery/slowly_charging'`.
  Re-enable with `sv up charge-limit` afterwards.

### Server watchdog
- `server-guard` runit service checks the local app (`:3000`), `cloudflared`
  PM2 state and the native face service (`:5080/health`) every 60 s.
- App: 3 consecutive failures → `pm2 restart fotohaven`.
- Tunnel: 2 misses → restart `cloudflared` (or `pm2 resurrect`).
- Face service: 2 misses → restart `native-face-service`.
- Logs low disk (<1 GB) and battery ≥45 °C once per transition.
- Log: `~/server-guard.log`; verified by stopping `fotohaven`: guard restored
  `:3000` to 307 and logged the 3 failed probes.

### Backups
- `daily-backup` runit service runs at **03:15 local** every day.
- `sqlite3 .backup` + `PRAGMA integrity_check` into
  `~/fotohaven-backups/daily/local-YYYYMMDD-HHMMSS.db`.
- Retains 7 daily DB copies; weekly (Sunday) uploads manifest, retained 30 days.
- Never deletes or modifies live uploads. Log: `~/daily-backup.log`.
- `--once` is available for a manual run; verified at setup (31 MB, integrity ok).

### One-screen status
```sh
~/bin/fotohaven-status.sh
```
Prints PM2, runit service status, battery limit state, local/public HTTP,
disk, and the last charge/guard log lines.



### Deployment state (2026-11-14)
- Server checkout: `~/fotohaven`, branch **`main`**, HEAD **`f2aa20b`**
  (`origin/main` is at the same commit; a docs-only follow-up may advance it)
- Branches merged into `main`: `feat/python-face-recognition`, `android-server-mode`
  and `perf/face-service`
- Built: `.next/BUILD_ID` generated `2026-11-14 23:12` from the same frontend tree;
  native face service restarted on the optimized Python code
- Previous build saved at `~/fotohaven/.next.backup-20261114-231104/`
- Pre-deploy local modifications preserved in `git stash@{0}`
- Application data (`local.db`, uploads) was not touched by checkout/build

Safe update procedure:

```sh
cd ~/fotohaven
git fetch origin
git checkout main
git pull --ff-only
# stop the watchdog during the build so it cannot restart a mid-build .next
export SVDIR=$PREFIX/var/service
sv down server-guard
pm2 stop fotohaven
cp -a .next ".next.backup-$(date +%Y%m%d-%H%M%S)"
npm run build                 # do NOT run npm install unless needed; see sharp note
pm2 start ecosystem.config.js --only fotohaven --update-env
pm2 restart native-face-service   # Python changes need no Next build
pm2 save
sv up server-guard
~/bin/fotohaven-status.sh
```

Face-service performance is tracked in
[`native-face-service/PERFORMANCE.md`](../../native-face-service/PERFORMANCE.md):
one-photo extraction improved from ~723–1073 ms to ~477 ms at the safe 2048
default (~335–410 ms with opt-in `FACE_DETECTION_MAX_SIDE=1600`), warm
`/search-by-photos` from ~65 ms to ~50 ms, with one enrollment worker and
`OPENCV_NUM_THREADS=8`.


Sharp/Android note: `@img/sharp-wasm32` is intentionally an optional dependency in
`package.json`, while the installed copy in `node_modules` is what makes thumbnails
work on bionic/ARM64. `npm install` may skip or prune it. If
`node -e "require('sharp')"` fails after an install, restore it with:

```sh
npm install --no-save --force @img/sharp-wasm32@0.34.5
```

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
- Automatic OTA updates disabled (`ota_disable_automatic_update=1`) so the phone
  cannot reboot itself mid-event; manual updates still work.
- Wireless debugging was observed off (`adb_wifi_enabled=0`).
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
| Charge limiter at 96% | stopped (`battery_charging_enabled=0`), `slowly_charging=1`, net +66 mA |
| Resume transition (temporary 100/100 thresholds) | `RESUME`, `battery_charging_enabled=1`; production daemon then re-stopped at 96% |
| Watchdog | stopped `fotohaven`; guard logged 3 failed probes and restored `:3000` to `307` |
| Daily backup `--once` | 31 MB DB, `PRAGMA integrity_check=ok` |
| runit | `charge-limit`, `server-guard`, `daily-backup` all `run` |
| Deployed branch | `android-server-mode` @ `b93d8e6` == `origin/android-server-mode` |
| Build | `.next` rebuilt 2026-11-14 23:12; `/api/share/[token]/select` present |
| App warm response | `/` → `307` in ~20 ms; 839-photo ceremony API 0.09–0.13 s |
| Public API | `https://fotohaven.live/api/share/<token>/.../photos` → `200` |
| Sharp on server | `sharp-ok`; `@img/sharp-wasm32` installed; thumbnails served |
| Data after deploy | uploads `9630 / 1.2G`, DB integrity `ok` |
| Admin login | `admin` → `200`, `/api/auth/me` → `200` |
| Upload lifecycle | temp album → PNG upload `200` → thumbnail job `completed`, `thumbnailKey` set, file present → album delete `200`, DB rows `0`, files gone |
| Password share | no/wrong/right = `401/401/200` |
| Batch select | `POST /api/share/:token/select` → `200 {updated:1}`, DB `isSelected=1` |
| ZIP download | valid photo → `200`, 81,522-byte zip in 0.29 s |
| Face service | extraction **477 ms** at 2048 (was 723–1073); **335–410 ms** at opt-in 1600; search-by-photos **50 ms** warm; selfie `/search` ~422 ms |
| Missing-file audit | 2 of 4,816 originals missing (`BCV06827.jpg`, `BCV06967.jpg`), 0 missing thumbnails; pre-existing rows, not deleted |

## Restore

```sh
# apps and background restrictions
sh ~/fotohaven-backups/20261114-212222/restore-disabled-apps.sh

# prior PM2 config (then restart)
cp ~/fotohaven-backups/20261114-212222/ecosystem.config.js.pre-server-mode ~/fotohaven/ecosystem.config.js
pm2 restart ecosystem.config.js --only fotohaven --update-env

# boot scripts
rm -f ~/.termux/boot/start-pm2 ~/.termux/boot/start-runit ~/.termux/boot/zz-server-tuning.sh

# battery charge limiter (disable limit, restore fast charging)
export SVDIR=$PREFIX/var/service
sv down charge-limit
su -c "echo 1 > /sys/class/power_supply/battery/battery_charging_enabled"
su -c "echo 0 > /sys/class/power_supply/battery/slowly_charging"

# optional: stop the watchdog/backup services
sv down server-guard daily-backup

# remove the runit service directories (optional)
rm -rf "$PREFIX/var/service/charge-limit" "$PREFIX/var/service/server-guard" "$PREFIX/var/service/daily-backup"
```

Data restore, if ever needed: stop PM2, restore `local.db` from `local.db.after` (or `local.db`), restore `uploads/` with `cp -a`, `pm2 resurrect`.

## Caveats

- **No physical reboot was performed.** The PM2 resurrect path was tested by killing PM2, and every boot script passes `sh -n`; a real reboot is the final proof. Termux:Boot and Termux are installed, enabled, and whitelisted.
- Disabling the Google app removes Assistant/Google search/At-a-Glance-style features on the phone. Re-enable with the restore script if needed.
- Play Store background updates may be delayed while `RUN_IN_BACKGROUND=ignore`; opening Play Store still works.
- The pm2-logrotate module adds ~30–60 MB RSS; it replaced 106 MB of unmanaged logs.
- The PM2 heap/limit change is in the device-local `ecosystem.config.js`. A `git pull`/`git checkout` on the phone can overwrite it; re-apply the two lines or merge them into the repo copy before redeploying.
- Battery: `charge_full=4.406 Ah` vs `charge_full_design=5.02 Ah` (~88% health, 28 cycles). The 80/75 limit and 1 A slow charge are intended to slow further loss. The battery will normally sit at 75–80%, not 100%; if you need a full charge, follow the restore steps above.
- Charge limiting is not a true power bypass: when `battery_charging_enabled=0`, the phone runs mostly from the battery (~60 mA idle), so a long outage still drains it. At 75–80% there is roughly a day of reserve at idle.
- Runit services are independent of PM2. `start-runit` starts `runsvdir` only if no instance is alive; the service directories themselves have no `down` file, so they auto-start.
- The runit services call `su` on each check. If KernelSU ever revokes root for Termux, the charge limit stops acting and logs `state unavailable`; the watchdog logs probe failures but cannot restart PM2 without root (PM2 itself does not need root).
- Daily backups are local to the phone (`~/fotohaven-backups/daily`, 7 × 31 MB). Copy them off-device for disaster recovery.
- The backup copy doubles upload storage while it exists (1.2 GB). It is on the same device; copy it off-device for disaster recovery.
- Tailscale is offline (`oppo-reno14-pro-5g`, last seen 1 day); Cloudflare is the active public path.
