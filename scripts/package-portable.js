// Builds a portable zip distribution for Windows.
//
// A single self-contained exe (via pkg/@yao-pkg/pkg etc.) was also considered, but
// node-notifier, used for Windows toast notifications, spawns a bundled binary such as
// snoretoast-x64.exe as an external process internally, which carries a compatibility risk
// of failing to run correctly when placed inside pkg's virtual snapshot filesystem. This
// project prioritizes reliability and ease of verification, so it bundles node_modules as
// real files in a portable zip instead (see the "About the distribution format" section in
// README.md for details).
const { execSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const RELEASE_DIR = path.join(ROOT, "release");
const STAGE_NAME = `token-recovery-notifier-portable-win-x64-v${pkg.version}`;
const STAGE_DIR = path.join(RELEASE_DIR, STAGE_NAME);
const ZIP_PATH = path.join(RELEASE_DIR, `${STAGE_NAME}.zip`);

function run(cmd, cwd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: cwd ?? ROOT, stdio: "inherit" });
}

function copyIfExists(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  } else {
    console.warn(`skip (not found): ${src}`);
  }
}

// 1. Prepare a clean staging directory
fs.rmSync(STAGE_DIR, { recursive: true, force: true });
fs.mkdirSync(STAGE_DIR, { recursive: true });

// 2. Build (tsc + copying tray.ps1)
run("npm run build");

// 3. Copy the files needed at runtime into the staging directory
fs.cpSync(path.join(ROOT, "dist"), path.join(STAGE_DIR, "dist"), { recursive: true });

const portablePkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  main: pkg.main,
  license: pkg.license,
  dependencies: pkg.dependencies,
};
fs.writeFileSync(path.join(STAGE_DIR, "package.json"), JSON.stringify(portablePkg, null, 2) + "\n");

// 4. Actually install production dependencies inside the staging directory
//    (node_modules is bundled as-is to keep node-notifier's bundled vendor exe as a real file)
run("npm install --omit=dev --no-audit --no-fund", STAGE_DIR);

// 5. Bundle the double-click launcher, uninstaller, and accompanying docs
fs.writeFileSync(
  path.join(STAGE_DIR, "TokenRecoveryNotifier.cmd"),
  '@echo off\r\nnode "%~dp0dist\\index.js"\r\n'
);
fs.writeFileSync(
  path.join(STAGE_DIR, "Uninstall.cmd"),
  '@echo off\r\nnode "%~dp0dist\\uninstall.js"\r\npause\r\n'
);
copyIfExists(path.join(ROOT, "README.md"), path.join(STAGE_DIR, "README.md"));
copyIfExists(path.join(ROOT, "README.en.md"), path.join(STAGE_DIR, "README.en.md"));
copyIfExists(path.join(ROOT, "LICENSE"), path.join(STAGE_DIR, "LICENSE"));

// 6. Zip it up (uses Windows' built-in Compress-Archive to avoid an extra compression library dependency)
fs.mkdirSync(RELEASE_DIR, { recursive: true });
fs.rmSync(ZIP_PATH, { force: true });
execFileSync("powershell.exe", [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  `Compress-Archive -Path "${STAGE_DIR}\\*" -DestinationPath "${ZIP_PATH}" -Force`,
]);

console.log(`Created: ${ZIP_PATH}`);
