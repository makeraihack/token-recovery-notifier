import { execFileSync } from "node:child_process";
import path from "node:path";
import { AUTOLAUNCH_REGISTRY_KEY, AUTOLAUNCH_VALUE_NAME } from "../config";
import { logger } from "../logger";

// dist/startup/autoLaunch.js から見た dist/index.js を起動コマンドにする
// (将来phase Bで単一exeへパッケージングする際は、ここを実行ファイルパスに差し替える必要がある)
function buildLaunchCommand(): string {
  const nodeExe = process.execPath;
  const entry = path.join(__dirname, "..", "index.js");
  return `"${nodeExe}" "${entry}"`;
}

export function enableAutoLaunch(): void {
  const command = buildLaunchCommand();
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
    logger.info(`Windows起動時の自動起動を登録しました: ${command}`);
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
