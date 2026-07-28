import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AUTOLAUNCH_LAUNCHER_SCRIPT_PATH,
  AUTOLAUNCH_REGISTRY_KEY,
  AUTOLAUNCH_VALUE_NAME,
} from "../config";
import { logger } from "../logger";

// dist/startup/autoLaunch.js から見た dist/index.js を起動コマンドにする
// (将来phase Bで単一exeへパッケージングする際は、ここを実行ファイルパスに差し替える必要がある)
function buildNodeCommand(): { nodeExe: string; entry: string } {
  const nodeExe = process.execPath;
  const entry = path.join(__dirname, "..", "index.js");
  return { nodeExe, entry };
}

// VBScriptのダブルクォートエスケープ（"" にする）
function vbsQuote(value: string): string {
  return value.replace(/"/g, '""');
}

// WshShell.Run の第2引数(0)がウィンドウ非表示起動を意味する。
// Runキーに直接node.exeを登録するとログイン毎にコンソールウィンドウが出てしまい、
// 誤って閉じられると常駐が止まる（実際にこの問題が起きた）ため、
// このVBScriptを中継して非表示で起動する。
function writeHiddenLauncherScript(): string {
  const { nodeExe, entry } = buildNodeCommand();
  const command = `"${vbsQuote(nodeExe)}" "${vbsQuote(entry)}"`;
  const script = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run "${vbsQuote(command)}", 0, False\r\n`;

  mkdirSync(path.dirname(AUTOLAUNCH_LAUNCHER_SCRIPT_PATH), { recursive: true });
  writeFileSync(AUTOLAUNCH_LAUNCHER_SCRIPT_PATH, script, "utf8");
  return AUTOLAUNCH_LAUNCHER_SCRIPT_PATH;
}

export function enableAutoLaunch(): void {
  const scriptPath = writeHiddenLauncherScript();
  const command = `wscript.exe "${scriptPath}"`;
  try {
    execFileSync("reg", [
      "add",
      AUTOLAUNCH_REGISTRY_KEY,
      "/v",
      AUTOLAUNCH_VALUE_NAME,
      "/t",
      "REG_SZ",
      "/d",
      command,
      "/f",
    ]);
    logger.info(`Windows起動時の自動起動を登録しました（非表示起動）: ${command}`);
  } catch (err) {
    logger.error(`自動起動の登録に失敗しました: ${(err as Error).message}`);
  }
}

export function disableAutoLaunch(): void {
  try {
    execFileSync("reg", ["delete", AUTOLAUNCH_REGISTRY_KEY, "/v", AUTOLAUNCH_VALUE_NAME, "/f"]);
    logger.info("自動起動の登録を解除しました");
  } catch (err) {
    logger.warn(`自動起動の解除に失敗しました（未登録だった可能性）: ${(err as Error).message}`);
  }
}

export function isAutoLaunchEnabled(): boolean {
  try {
    execFileSync("reg", ["query", AUTOLAUNCH_REGISTRY_KEY, "/v", AUTOLAUNCH_VALUE_NAME]);
    return true;
  } catch {
    return false;
  }
}
