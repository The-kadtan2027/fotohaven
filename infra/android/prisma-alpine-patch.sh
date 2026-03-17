#!/bin/sh

# prisma-alpine-patch.sh
# 
# This script must be run INSIDE the Termux Alpine environment (`startalpine`)
# AFTER running `npm install` and the `prisma-android-fix.js` postinstall script.
#
# It uses `patchelf` to modify the downloaded musl Prisma binaries so they use
# the correct Alpine linker and library paths, preventing crashes when Next.js
# starts the query-engine.

set -e

echo "[prisma-alpine-patch] Starting Prisma binary patch for Alpine musl..."

# Ensure patchelf is installed
if ! command -v patchelf >/dev/null 2>&1; then
    echo "[prisma-alpine-patch] Installing patchelf..."
    apk add --no-cache patchelf
fi

PROJECT_DIR="/data/data/com.termux/files/home/fotohaven"
ENGINES_DIR="$PROJECT_DIR/node_modules/@prisma/engines"
CLIENT_DIR="$PROJECT_DIR/node_modules/.prisma/client"

# The 4 binaries we need to patch
BINARIES="
$ENGINES_DIR/query-engine-linux-musl-arm64-openssl-3.0.x
$ENGINES_DIR/schema-engine-linux-musl-arm64-openssl-3.0.x
$CLIENT_DIR/query-engine-linux-musl-arm64-openssl-3.0.x
$CLIENT_DIR/schema-engine-linux-musl-arm64-openssl-3.0.x
"

LINKER="/lib/ld-musl-aarch64.so.1"
RPATH="/usr/lib:/lib"

for binary in $BINARIES; do
    if [ -f "$binary" ]; then
        echo "[prisma-alpine-patch] Patching $(basename "$binary")..."
        patchelf --set-interpreter "$LINKER" "$binary"
        patchelf --set-rpath "$RPATH" "$binary"
    else
        echo "[prisma-alpine-patch] WARNING: Binary not found: $binary"
    fi
done

echo "[prisma-alpine-patch] Verifying schema-engine..."
if "$CLIENT_DIR/schema-engine-linux-musl-arm64-openssl-3.0.x" --version >/dev/null 2>&1; then
    echo "[prisma-alpine-patch] ✅ Patch successful! Binaries are ready."
else
    echo "[prisma-alpine-patch] ❌ Verification failed. The binary cannot be executed."
    exit 1
fi
