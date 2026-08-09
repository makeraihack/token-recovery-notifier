import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AUTOLAUNCH_ELEVATE_SCRIPT_PATH,
  AUTOLAUNCH_LAUNCHER_SCRIPT_PATH,
  AUTOLAUNCH_LOGON_TASK_NAME,
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

// PowerShellシングルクォート文字列内のエスケープ（' を '' にする）
function psSingleQuote(value: string): string {
  return value.replace(/'/g, "''");
}

// WshShell.Run の第2引数(0)がウィンドウ非表示起動を意味する。
// タスクスケジューラの起動アクションに直接node.exeを登録するとコンソールウィンドウが出てしまい、
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

/**
 * ログオン時起動タスク(ONLOGONトリガー)をUAC昇格つきで登録するPowerShellスクリプトを書き出す。
 * schtasksでのONLOGONトリガー作成は通常権限だと"Access is denied"で失敗するため、
 * Start-Process -Verb RunAsで管理者権限のschtasksプロセスだけを起動しUACダイアログを出す
 * (アプリ本体を管理者として起動し直す必要はない)。
 */
function writeElevateRegisterScript(launcherPath: string): string {
  const taskName = psSingleQuote(AUTOLAUNCH_LOGON_TASK_NAME);
  const launcherQuoted = psSingleQuote(launcherPath);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$taskName = '${taskName}'`,
    `$tr = "wscript.exe " + '${launcherQuoted}'`,
    "try {",
    "    $proc = Start-Process -FilePath 'schtasks.exe' -ArgumentList @('/Create','/TN',$taskName,'/TR',$tr,'/SC','ONLOGON','/RL','LIMITED','/F') -Verb RunAs -WindowStyle Hidden -Wait -PassThru",
    "    if ($proc.ExitCode -ne 0) { exit 1 }",
    "    exit 0",
    "} catch {",
    "    exit 1",
    "}",
    "",
  ].join("\r\n");

  mkdirSync(path.dirname(AUTOLAUNCH_ELEVATE_SCRIPT_PATH), { recursive: true });
  writeFileSync(AUTOLAUNCH_ELEVATE_SCRIPT_PATH, script, "utf8");
  return AUTOLAUNCH_ELEVATE_SCRIPT_PATH;
}

function deleteTask(taskName: string): void {
  execFileSync("schtasks", ["/Delete", "/TN", taskName, "/F"]);
}

function queryTask(taskName: string): boolean {
  try {
    execFileSync("schtasks", ["/Query", "/TN", taskName]);
    return true;
  } catch {
    return false;
  }
}

// 旧バージョンで使っていたレジストリRunキーの登録が残っていれば削除する
// (ログオン時タスクと二重起動しないようにするため)
function cleanupLegacyRegistryAutoLaunch(): void {
  try {
    execFileSync("reg", ["query", AUTOLAUNCH_REGISTRY_KEY, "/v", AUTOLAUNCH_VALUE_NAME]);
  } catch {
    return; // 未登録なら何もしない
  }
  try {
    execFileSync("reg", ["delete", AUTOLAUNCH_REGISTRY_KEY, "/v", AUTOLAUNCH_VALUE_NAME, "/f"]);
    logger.info("旧レジストリRunキーの自動起動登録を削除しました（タスクスケジューラへ移行）");
  } catch (err) {
    logger.warn(`旧レジストリRunキーの削除に失敗しました: ${(err as Error).message}`);
  }
}

export function isLogonTaskRegistered(): boolean {
  return queryTask(AUTOLAUNCH_LOGON_TASK_NAME);
}

/**
 * ログオン時起動タスクをUAC昇格つきで登録する。
 * UACダイアログはユーザー操作を伴うためノンブロッキングで実行し、結果はログとコールバックで通知する。
 * タスクトレイメニューの「ログオン時起動を登録」からも、初回起動時の自動試行からも呼ばれる。
 */
export function requestLogonTaskRegistration(onDone?: (success: boolean) => void): void {
  const launcherPath = writeHiddenLauncherScript();
  const elevateScriptPath = writeElevateRegisterScript(launcherPath);

  logger.info("ログオン時起動タスクの登録には管理者権限が必要です。確認ダイアログ(UAC)を表示します");

  let child;
  try {
    child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", elevateScriptPath],
      { stdio: "ignore" }
    );
  } catch (err) {
    logger.error(`ログオン時起動タスクの登録プロセスの起動に失敗しました: ${(err as Error).message}`);
    onDone?.(false);
    return;
  }

  child.on("error", (err) => {
    logger.error(`ログオン時起動タスクの登録プロセスでエラーが発生しました: ${err.message}`);
    onDone?.(false);
  });
  child.on("exit", (code) => {
    if (code === 0) {
      logger.info("ログオン時起動タスクを登録しました（管理者権限）");
      onDone?.(true);
    } else {
      logger.warn(
        `ログオン時起動タスクの登録がキャンセルまたは失敗しました(code=${code})。UACで「いいえ」を選んだ可能性があります`
      );
      onDone?.(false);
    }
  });
}

/**
 * 常駐に必要な自動起動関連の登録を行う。
 * - 旧レジストリRunキーが残っていれば削除
 * - ログオン時起動タスクが未登録なら、初回起動時として自動的にUAC昇格登録を試みる
 *   (タスクトレイメニュー「ログオン時起動を登録...」からいつでも再試行できる)
 */
export function enableAutoLaunch(): void {
  cleanupLegacyRegistryAutoLaunch();
  writeHiddenLauncherScript();

  if (!isLogonTaskRegistered()) {
    logger.info("ログオン時起動タスクが未登録のため、初回登録を試みます");
    requestLogonTaskRegistration();
  }
}

export function disableAutoLaunch(): void {
  cleanupLegacyRegistryAutoLaunch();

  try {
    deleteTask(AUTOLAUNCH_LOGON_TASK_NAME);
    logger.info(`自動起動タスクの登録を解除しました: ${AUTOLAUNCH_LOGON_TASK_NAME}`);
  } catch (err) {
    logger.warn(
      `自動起動タスクの解除に失敗しました（未登録だった、または管理者権限が必要な可能性）: ${AUTOLAUNCH_LOGON_TASK_NAME} (${(err as Error).message})`
    );
  }
}

export function isAutoLaunchEnabled(): boolean {
  return isLogonTaskRegistered();
}
