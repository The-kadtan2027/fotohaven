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

const TARGET_BINARY = 'linux-arm64-openssl-3.0.x';
const BINARY_NAME = `query-engine-${TARGET_BINARY}`;
const NODE_MODULES_PRISMA = path.join(process.cwd(), 'node_modules', '@prisma', 'engines');
const PRISMA_CLIENT_DIR = path.join(process.cwd(), 'node_modules', '.prisma', 'client');

// 1. Detect if we are on Android/Termux
if (process.platform !== 'android' && process.env.FORCE_PRISMA_FIX !== 'true') {
    console.log('Not on Android. Skipping Prisma engine fix.');
    process.exit(0);
}

console.log('▶ Starting Prisma Android/Termux engine fix...');

try {
    // 2. Get the engine hash from @prisma/engines package.json
    const enginesPkgPath = path.join(NODE_MODULES_PRISMA, 'package.json');
    if (!fs.existsSync(enginesPkgPath)) {
        console.error('❌ Could not find node_modules/@prisma/engines/package.json');
        process.exit(1);
    }

    const enginesPkg = JSON.parse(fs.readFileSync(enginesPkgPath, 'utf8'));
    const engineVersion = enginesPkg['@prisma/engines-version'];
    
    if (!engineVersion) {
        console.error('❌ Could not find @prisma/engines-version in package.json');
        process.exit(1);
    }

    console.log(`✓ Detected Prisma Engine Hash: ${engineVersion}`);

    // 3. Construct download URL
    const downloadUrl = `https://binaries.prisma.sh/all_commits/${engineVersion}/${TARGET_BINARY}/query-engine.gz`;
    const tempGzPath = path.join(process.cwd(), 'query-engine.gz');
    const finalBinaryPath = path.join(NODE_MODULES_PRISMA, BINARY_NAME);

    console.log(`▶ Downloading engine from: ${downloadUrl}`);

    const file = fs.createWriteStream(tempGzPath);
    https.get(downloadUrl, (response) => {
        if (response.statusCode !== 200) {
            console.error(`❌ Failed to download: ${response.statusCode} ${response.statusMessage}`);
            process.exit(1);
        }

        response.pipe(file);

        file.on('finish', () => {
            file.close();
            console.log('✓ Download complete. Extracting...');

            // 4. Extract (gunzip)
            const compressed = fs.readFileSync(tempGzPath);
            const decompressed = zlib.gunzipSync(compressed);
            fs.writeFileSync(finalBinaryPath, decompressed);
            fs.unlinkSync(tempGzPath);

            // 5. Place it where Prisma Client looks
            const clientBinaryPath = path.join(PRISMA_CLIENT_DIR, BINARY_NAME);
            if (fs.existsSync(PRISMA_CLIENT_DIR)) {
                fs.copyFileSync(finalBinaryPath, clientBinaryPath);
                fs.chmodSync(clientBinaryPath, 0o755);
                console.log(`✓ Copied to ${clientBinaryPath}`);
            }

            fs.chmodSync(finalBinaryPath, 0o755);
            console.log(`✓ Extracted to ${finalBinaryPath}`);

            // 6. Delete incompatible x86_64 library engines to avoid confusion
            const targets = [NODE_MODULES_PRISMA, PRISMA_CLIENT_DIR];
            targets.forEach(dir => {
                if (fs.existsSync(dir)) {
                    fs.readdirSync(dir).forEach(f => {
                        if (f.startsWith('libquery_engine-debian') || (f.startsWith('libquery_engine') && f.endsWith('.node'))) {
                            console.log(`▶ Deleting incompatible engine: ${f}`);
                            try { fs.unlinkSync(path.join(dir, f)); } catch(e) {}
                        }
                    });
                }
            });

            console.log('✅ Prisma Android engine fix applied successfully.');
        });
    }).on('error', (err) => {
        fs.unlinkSync(tempGzPath);
        console.error(`❌ Download error: ${err.message}`);
        process.exit(1);
    });

} catch (err) {
    console.error('❌ Unexpected error:', err);
    process.exit(1);
}
