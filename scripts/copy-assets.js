// tsc doesn't copy non-.ts assets (tray.ps1, icon.ico), so place them into dist after the build
const fs = require("node:fs");
const path = require("node:path");

const destDir = path.join(__dirname, "..", "dist", "tray");
fs.mkdirSync(destDir, { recursive: true });

const assets = ["tray.ps1", "icon.ico"];
for (const name of assets) {
  const src = path.join(__dirname, "..", "src", "tray", name);
  const dest = path.join(destDir, name);
  fs.copyFileSync(src, dest);
  console.log(`copied: ${src} -> ${dest}`);
}
