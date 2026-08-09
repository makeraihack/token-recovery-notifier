import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import {
  APP_NAME,
  AUTOLAUNCH_LOGON_TASK_NAME,
  AUTOLAUNCH_REGISTRY_KEY,
  AUTOLAUNCH_VALUE_NAME,
  DATA_DIR,
} from "./config";

// This runs as a standalone CLI entry point (via `npm run uninstall` or the portable
// build's Uninstall.cmd), never as part of the resident app. It intentionally avoids the
// shared `logger` module: that writes into DATA_DIR, which this script is about to delete,
// and mixing "app log" output with "uninstaller" output would be confusing anyway.
function report(message: string): void {
  console.log(message);
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

// Finds and stops any running instance of this app so the Task Scheduler task can be
// removed cleanly and DATA_DIR isn't locked (e.g. by an open log file handle) while we
// delete it.
function stopRunningInstances(): void {
  const entryPath = path.join(__dirname, "index.js");
  const psScript = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$pattern = '*' + '${entryPath.replace(/'/g, "''")}' + '*'`,
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |",
    "  Where-Object { $_.CommandLine -like $pattern } |",
    "  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
  ].join("\r\n");

  try {
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript]);
    report("Stopped any running instance of the app.");
  } catch (err) {
    report(`Warning: failed to stop a running instance (it may not have been running): ${(err as Error).message}`);
  }
}

// Deleting the logon-time task requires administrator privileges, same as creating it, so
// this elevates just the schtasks call via a UAC prompt. Written to the OS temp directory
// (not DATA_DIR) since DATA_DIR is removed later in this same run.
function removeLogonTask(): void {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "trn-uninstall-"));
  const scriptPath = path.join(tmpDir, "remove-logon-task.ps1");
  const taskName = AUTOLAUNCH_LOGON_TASK_NAME.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$taskName = '${taskName}'`,
    "try {",
    "    $proc = Start-Process -FilePath 'schtasks.exe' -ArgumentList @('/Delete','/TN',$taskName,'/F') -Verb RunAs -WindowStyle Hidden -Wait -PassThru",
    "    if ($proc.ExitCode -ne 0) { exit 1 }",
    "    exit 0",
    "} catch {",
    "    exit 1",
    "}",
    "",
  ].join("\r\n");
  writeFileSync(scriptPath, script, "utf8");

  report("Removing the logon-time startup task requires administrator privileges. Showing the UAC prompt...");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath]);
    report("Removed the logon-time startup task.");
  } catch {
    report(
      `Warning: could not remove the logon-time startup task "${AUTOLAUNCH_LOGON_TASK_NAME}" (it may not have been registered, or the UAC prompt may have been declined). ` +
        "If it still shows up in Task Scheduler afterwards, you can delete it there manually."
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function removeLegacyRegistryKey(): void {
  try {
    execFileSync("reg", ["query", AUTOLAUNCH_REGISTRY_KEY, "/v", AUTOLAUNCH_VALUE_NAME]);
  } catch {
    return; // Nothing to do if it isn't registered
  }
  try {
    execFileSync("reg", ["delete", AUTOLAUNCH_REGISTRY_KEY, "/v", AUTOLAUNCH_VALUE_NAME, "/f"]);
    report("Removed the legacy registry Run key registration.");
  } catch (err) {
    report(`Warning: failed to remove the legacy registry Run key: ${(err as Error).message}`);
  }
}

function removeDataDir(): void {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
    report(`Removed the app data folder: ${DATA_DIR}`);
  } catch (err) {
    report(`Warning: failed to remove ${DATA_DIR}: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  report(`This will uninstall ${APP_NAME}.`);
  report("It will: stop the app if running, remove the logon-time startup task (UAC required),");
  report(`remove any legacy startup registration, and delete ${DATA_DIR} (log file and settings).`);

  const proceed = await confirm("Continue?");
  if (!proceed) {
    report("Cancelled. Nothing was changed.");
    return;
  }

  stopRunningInstances();
  removeLogonTask();
  removeLegacyRegistryKey();
  removeDataDir();

  report("");
  report("Uninstall steps complete.");
  report(
    "One manual step remains: delete this app's own folder (the one containing dist/, node_modules/, etc.) " +
      "whenever you're ready — it's just files, so it's safe to delete like any other folder."
  );
}

void main();
