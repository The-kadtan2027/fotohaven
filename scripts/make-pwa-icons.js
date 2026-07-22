const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const publicIconsDir = path.join(__dirname, "..", "public", "icons");
if (!fs.existsSync(publicIconsDir)) {
  fs.mkdirSync(publicIconsDir, { recursive: true });
}

function generateSvg(size) {
  const fontSize = Math.round(size * 0.28);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#1a1208"/>
    <circle cx="${size / 2}" cy="${size * 0.42}" r="${size * 0.28}" fill="none" stroke="#C4A86C" stroke-width="${Math.max(2, Math.round(size * 0.02))}"/>
    <path d="M${size * 0.36} ${size * 0.36} h${size * 0.28} v${size * 0.2} h-${size * 0.28} z" fill="#C4A86C"/>
    <circle cx="${size / 2}" cy="${size * 0.46}" r="${size * 0.08}" fill="#1a1208"/>
    <text x="50%" y="${size * 0.84}" font-family="serif" font-size="${fontSize}" font-weight="600" fill="#C4A86C" text-anchor="middle">FH</text>
  </svg>`;
}

async function main() {
  const svg192 = Buffer.from(generateSvg(192));
  const svg512 = Buffer.from(generateSvg(512));

  fs.writeFileSync(path.join(publicIconsDir, "icon-192.svg"), svg192);
  fs.writeFileSync(path.join(publicIconsDir, "icon-512.svg"), svg512);

  await sharp(svg192).png().toFile(path.join(publicIconsDir, "icon-192.png"));
  await sharp(svg512).png().toFile(path.join(publicIconsDir, "icon-512.png"));

  console.log("PWA PNG & SVG Icons generated successfully in public/icons/");
}

main().catch(console.error);
