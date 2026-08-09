// tsc doesn't copy tray.ps1 (not a .ts file), so place it into dist after the build
const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..", "src", "tray", "tray.ps1");
const destDir = path.join(__dirname, "..", "dist", "tray");
const dest = path.join(destDir, "tray.ps1");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`copied: ${src} -> ${dest}`);
