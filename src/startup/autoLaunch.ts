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

// Builds the launch command for dist/index.js as seen from dist/startup/autoLaunch.js
// (if this is ever packaged into a single exe in a future phase, this path needs to be
// swapped for the executable's path)
function buildNodeCommand(): { nodeExe: string; entry: string } {
  const nodeExe = process.execPath;
  const entry = path.join(__dirname, "..", "index.js");
  return { nodeExe, entry };
}

// Escapes double quotes for VBScript (turns " into "")
function vbsQuote(value: string): string {
  return value.replace(/"/g, '""');
}

// Escapes single quotes inside a PowerShell single-quoted string (turns ' into '')
function psSingleQuote(value: string): string {
  return value.replace(/'/g, "''");
}

// The second argument (0) to WshShell.Run means "launch with no visible window."
// Registering node.exe directly as the Task Scheduler action would show a console window
// on every launch, and accidentally closing it would kill the resident app (this actually
// happened), so this VBScript is used as a hidden-launch relay.
function writeHiddenLauncherScript(): string {
  const { nodeExe, entry } = buildNodeCommand();
  const command = `"${vbsQuote(nodeExe)}" "${vbsQuote(entry)}"`;
  const script = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run "${vbsQuote(command)}", 0, False\r\n`;

  mkdirSync(path.dirname(AUTOLAUNCH_LAUNCHER_SCRIPT_PATH), { recursive: true });
  writeFileSync(AUTOLAUNCH_LAUNCHER_SCRIPT_PATH, script, "utf8");
  return AUTOLAUNCH_LAUNCHER_SCRIPT_PATH;
}

/**
 * Writes out a PowerShell script that registers the logon-time task (an ONLOGON trigger)
 * with UAC elevation. Creating an ONLOGON trigger via schtasks fails with "Access is denied"
 * under a standard user token, so Start-Process -Verb RunAs is used to launch only the
 * schtasks process with elevation and show the UAC dialog (the app itself never needs to be
 * relaunched as administrator).
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

// Removes any leftover legacy registry Run key registration from an older version
// (to avoid launching the app twice alongside the logon-time task)
function cleanupLegacyRegistryAutoLaunch(): void {
  try {
    execFileSync("reg", ["query", AUTOLAUNCH_REGISTRY_KEY, "/v", AUTOLAUNCH_VALUE_NAME]);
  } catch {
    return; // Nothing to do if it isn't registered
  }
  try {
    execFileSync("reg", ["delete", AUTOLAUNCH_REGISTRY_KEY, "/v", AUTOLAUNCH_VALUE_NAME, "/f"]);
    logger.info("Removed the legacy registry Run key registration (migrated to Task Scheduler)");
  } catch (err) {
    logger.warn(`Failed to remove the legacy registry Run key: ${(err as Error).message}`);
  }
}

export function isLogonTaskRegistered(): boolean {
  return queryTask(AUTOLAUNCH_LOGON_TASK_NAME);
}

/**
 * Registers the logon-time startup task with UAC elevation.
 * Runs non-blocking since the UAC dialog requires user interaction; the outcome is reported
 * via logging and the callback. Called both from the tray menu's "Register logon-time
 * startup..." item and from the automatic attempt on first launch.
 */
export function requestLogonTaskRegistration(onDone?: (success: boolean) => void): void {
  const launcherPath = writeHiddenLauncherScript();
  const elevateScriptPath = writeElevateRegisterScript(launcherPath);

  logger.info("Registering the logon-time startup task requires administrator privileges. Showing the UAC prompt");

  let child;
  try {
    child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", elevateScriptPath],
      { stdio: "ignore" }
    );
  } catch (err) {
    logger.error(`Failed to launch the logon-time task registration process: ${(err as Error).message}`);
    onDone?.(false);
    return;
  }

  child.on("error", (err) => {
    logger.error(`An error occurred in the logon-time task registration process: ${err.message}`);
    onDone?.(false);
  });
  child.on("exit", (code) => {
    if (code === 0) {
      logger.info("Registered the logon-time startup task (administrator privileges)");
      onDone?.(true);
    } else {
      logger.warn(
        `Logon-time task registration was cancelled or failed (code=${code}). The UAC prompt may have been declined`
      );
      onDone?.(false);
    }
  });
}

/**
 * Performs the auto-launch-related registration needed for the app to run resident.
 * - Removes any leftover legacy registry Run key
 * - If the logon-time startup task isn't registered yet, attempts UAC-elevated registration
 *   as a first-launch action (can always be retried later via the tray menu's
 *   "Register logon-time startup..." item)
 */
export function enableAutoLaunch(): void {
  cleanupLegacyRegistryAutoLaunch();
  writeHiddenLauncherScript();

  if (!isLogonTaskRegistered()) {
    logger.info("The logon-time startup task isn't registered yet, attempting first-time registration");
    requestLogonTaskRegistration();
  }
}

export function disableAutoLaunch(): void {
  cleanupLegacyRegistryAutoLaunch();

  try {
    deleteTask(AUTOLAUNCH_LOGON_TASK_NAME);
    logger.info(`Removed the auto-launch task registration: ${AUTOLAUNCH_LOGON_TASK_NAME}`);
  } catch (err) {
    logger.warn(
      `Failed to remove the auto-launch task (it may not have been registered, or administrator privileges may be required): ${AUTOLAUNCH_LOGON_TASK_NAME} (${(err as Error).message})`
    );
  }
}

export function isAutoLaunchEnabled(): boolean {
  return isLogonTaskRegistered();
}
