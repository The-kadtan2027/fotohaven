#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

LOCKDIR="/data/data/com.termux/files/home/.fotohaven-faces-lock"
APP_DIR="/data/data/com.termux/files/home/fotohaven"

if mkdir "$LOCKDIR" 2>/dev/null; then
  trap 'rmdir "$LOCKDIR"' EXIT

  cd "$APP_DIR"

  # Keep env aligned with Termux native module expectations.
  export android_ndk_path="${android_ndk_path:-$PREFIX}"
  export GYP_DEFINES="${GYP_DEFINES:-android_ndk_path=$android_ndk_path}"
  export PKG_CONFIG_PATH="${PKG_CONFIG_PATH:-$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig}"
  export CFLAGS="${CFLAGS:--I$PREFIX/include}"
  export CXXFLAGS="${CXXFLAGS:--I$PREFIX/include}"
  export LDFLAGS="${LDFLAGS:--L$PREFIX/lib}"

  # Optional override: if your photos live elsewhere, set LOCAL_UPLOAD_PATH
  # in PM2 env or uncomment and edit below.
  # export LOCAL_UPLOAD_PATH="/data/data/com.termux/files/home/storage/shared/fotohaven"
  export LOCAL_UPLOAD_PATH="/data/data/com.termux/files/home/storage/shared/fotohaven-uploads"
  export PROCESS_FACES_SOURCE="${PROCESS_FACES_SOURCE:-auto}"
  export PROCESS_FACES_LIMIT="${PROCESS_FACES_LIMIT:-25}"


  npm run faces:process
else
  echo "[faces] Previous run still active, skipping."
fi
