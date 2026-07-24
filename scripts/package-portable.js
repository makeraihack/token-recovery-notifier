// Windows向けポータブルzip配布物を作成する。
//
// 単一の自己完結型exe化(pkg/@yao-pkg/pkg等)も検討したが、Windowsトースト通知に
// 使うnode-notifierは内部でsnoretoast-x64.exe等の同梱バイナリを外部プロセスとして
// spawnする仕組みになっており、pkgの仮想スナップショットファイルシステム上に
// 置いた場合に正しく実行できない相性リスクがある。今回は動作の確実性・検証の
// しやすさを優先し、node_modulesを実ファイルのまま同梱するポータブルzip方式にした
// (詳細はREADME.mdの「配布形式について」を参照)。
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

// 1. クリーンなステージングディレクトリを用意する
fs.rmSync(STAGE_DIR, { recursive: true, force: true });
fs.mkdirSync(STAGE_DIR, { recursive: true });

// 2. ビルド(tsc + tray.ps1のコピー)
run("npm run build");

// 3. 実行に必要なファイルをステージングへコピー
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

// 4. 本番依存のみをステージング内に実インストールする
//    (node-notifier同梱のvendor exeを実ファイルとして保持するため、node_modulesはそのまま同梱する)
run("npm install --omit=dev --no-audit --no-fund", STAGE_DIR);

// 5. ダブルクリック起動用ランチャーと関連ドキュメントを同梱する
fs.writeFileSync(
  path.join(STAGE_DIR, "TokenRecoveryNotifier.cmd"),
  '@echo off\r\nnode "%~dp0dist\\index.js"\r\n'
);
copyIfExists(path.join(ROOT, "README.md"), path.join(STAGE_DIR, "README.md"));
copyIfExists(path.join(ROOT, "LICENSE"), path.join(STAGE_DIR, "LICENSE"));

// 6. zip化(Windows標準搭載のCompress-Archiveを利用し、追加の圧縮ライブラリ依存を避ける)
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

console.log(`作成しました: ${ZIP_PATH}`);
