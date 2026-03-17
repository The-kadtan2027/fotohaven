const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { execSync } = require('child_process');

/**
 * prisma-android-fix.js
 * 
 * Automates the downloading and placement of the ARM64 Prisma query engine
 * for Android/Termux environments. prisma/prisma-client-js doesn't natively 
 * fetch the correct ARM64 binary for Termux yet.
 */

const TARGET_BINARY = 'linux-musl-arm64-openssl-3.0.x';
const ENGINES_TO_DOWNLOAD = ['query-engine', 'schema-engine'];
const NODE_MODULES_PRISMA = path.join(process.cwd(), 'node_modules', '@prisma', 'engines');
const PRISMA_CLIENT_DIR = path.join(process.cwd(), 'node_modules', '.prisma', 'client');

// 1. Detect if we are on Android/Termux
// Note: Node.js on Termux reports process.platform === 'linux', not 'android'.
// We detect Termux via the TERMUX_VERSION env var (always set by Termux) or
// by checking for the Termux data directory as a fallback.
const isTermux = process.env.TERMUX_VERSION != null ||
    fs.existsSync('/data/data/com.termux');

if (!isTermux && process.env.FORCE_PRISMA_FIX !== 'true') {
    console.log('[prisma-android-fix] Not on Termux/Android. Skipping.');
    process.exit(0);
}

console.log('[prisma-android-fix] Starting Prisma Android fix...');

try {
    // 2. Get the engine hash from @prisma/engines package.json
    const enginesPkgPath = path.join(NODE_MODULES_PRISMA, 'package.json');
    if (!fs.existsSync(enginesPkgPath)) {
        console.error('❌ Could not find node_modules/@prisma/engines/package.json');
        process.exit(1);
    }

    const rawPkgText = fs.readFileSync(enginesPkgPath, 'utf8');

    // Use regex on raw text so nesting depth doesn't matter.
    // Prisma 5.22+ embeds the field inside a nested object; JSON.parse root-key
    // lookup returns undefined. The regex finds it wherever it appears.
    const pkgHashMatch = rawPkgText.match(/"@prisma\/engines-version"\s*:\s*"([^"]+)"/);
    let rawEngineVersion = pkgHashMatch ? pkgHashMatch[1] : null;

    if (!rawEngineVersion) {
        // Fallback: scan dist/index.js for a 40-char hex SHA (the engine hash).
        const distPath = path.join(NODE_MODULES_PRISMA, 'dist', 'index.js');
        if (fs.existsSync(distPath)) {
            const distText = fs.readFileSync(distPath, 'utf8');
            const distMatch = distText.match(/enginesVersion\s*[:=]\s*["'`]([^"'`]+)["'`]/);
            if (distMatch) rawEngineVersion = distMatch[1];
        }
    }

    if (!rawEngineVersion) {
        console.error('[prisma-android-fix] Could not find engine hash.');
        console.error('[prisma-android-fix] Tried: @prisma/engines-version in package.json and dist/index.js');
        process.exit(1);
    }

    // Prisma 5.22+ uses format "5.22.0-44.{40-char-hash}" — extract just the hash.
    // Older versions may use the hash directly. Handle both.
    const engineHash = rawEngineVersion.includes('-')
        ? rawEngineVersion.split('.').pop()
        : rawEngineVersion;

    console.log(`[prisma-android-fix] Engine version: ${rawEngineVersion}`);
    console.log(`[prisma-android-fix] Engine hash: ${engineHash}`);

    // Download both query-engine and schema-engine sequentially
    let downloadsCompleted = 0;

    ENGINES_TO_DOWNLOAD.forEach(enginePrefix => {
        const downloadUrl = `https://binaries.prisma.sh/all_commits/${engineHash}/${TARGET_BINARY}/${enginePrefix}.gz`;
        const tempGzPath = path.join(process.cwd(), `${enginePrefix}.gz`);
        const finalBinaryName = `${enginePrefix}-${TARGET_BINARY}`;
        const finalBinaryPath = path.join(NODE_MODULES_PRISMA, finalBinaryName);

        console.log(`[prisma-android-fix] Downloading ${enginePrefix} from: ${downloadUrl}`);

        const file = fs.createWriteStream(tempGzPath);
        https.get(downloadUrl, (response) => {
            if (response.statusCode !== 200) {
                console.error(`❌ Failed to download ${enginePrefix}: ${response.statusCode} ${response.statusMessage}`);
                process.exit(1);
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log(`[prisma-android-fix] ${enginePrefix} downloaded. Extracting...`);

                // Extract (gunzip)
                const compressed = fs.readFileSync(tempGzPath);
                const decompressed = zlib.gunzipSync(compressed);
                fs.writeFileSync(finalBinaryPath, decompressed);
                fs.unlinkSync(tempGzPath);

                // Place it where Prisma Client looks
                const clientBinaryPath = path.join(PRISMA_CLIENT_DIR, finalBinaryName);
                if (fs.existsSync(PRISMA_CLIENT_DIR)) {
                    fs.copyFileSync(finalBinaryPath, clientBinaryPath);
                    fs.chmodSync(clientBinaryPath, 0o755);
                    console.log(`[prisma-android-fix] Copied to ${clientBinaryPath}`);
                }

                fs.chmodSync(finalBinaryPath, 0o755);
                console.log(`[prisma-android-fix] Extracted to ${finalBinaryPath}`);

                downloadsCompleted++;
                checkIfDone();
            });
        }).on('error', (err) => {
            fs.unlinkSync(tempGzPath);
            console.error(`❌ Download error for ${enginePrefix}: ${err.message}`);
            process.exit(1);
        });
    });

    function checkIfDone() {
        if (downloadsCompleted === ENGINES_TO_DOWNLOAD.length) {
            // Delete incompatible x86_64 library engines to avoid confusion
            const targets = [NODE_MODULES_PRISMA, PRISMA_CLIENT_DIR];
            targets.forEach(dir => {
                if (fs.existsSync(dir)) {
                    fs.readdirSync(dir).forEach(f => {
                        if (f.startsWith('libquery_engine-debian') || (f.startsWith('libquery_engine') && f.endsWith('.node'))) {
                            console.log(`[prisma-android-fix] Deleting incompatible engine: ${f}`);
                            try { fs.unlinkSync(path.join(dir, f)); } catch(e) {}
                        }
                    });
                }
            });

            console.log('[prisma-android-fix] ✅ Done. ARM64 engines placed successfully.');
        }
    }

} catch (err) {
    console.error('❌ Unexpected error:', err);
    process.exit(1);
}
