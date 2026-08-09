import os from "node:os";
import path from "node:path";

export const APP_NAME = "Token Recovery Notifier";

// Directory where Claude Code CLI writes session transcripts (unofficial, must be watched)
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// Cover both top-level and subagent jsonl files
export const JSONL_GLOB = "**/*.jsonl";

// Fallback polling interval for tail reads (fs.watch events are primary; this is a safety net)
export const WATCH_POLL_INTERVAL_MS = 3000;

// Upper bound, in bytes, on how far back from the end of a file we scan on app startup
// to find the most recent rate_limit event. Transcripts can grow to tens of thousands of
// lines, so a full scan is avoided; only the most recent event (which may not have reset
// yet) matters. If a rate-limit event is still active (not yet reset), the CLI can't write
// further normal responses after it, so that event is effectively near the end of the file.
export const STARTUP_SCAN_MAX_BYTES = 256 * 1024;

export const LOG_FILE_PATH = path.join(os.homedir(), ".token-recovery-notifier", "app.log");

// File for user-specific settings such as the Slack webhook URL (optional, works fine if absent)
export const USER_CONFIG_FILE_PATH = path.join(os.homedir(), ".token-recovery-notifier", "config.json");

// Legacy registry Run key used by older versions. It only tries to launch once at sign-in,
// so if the app crashed or was force-killed, it wouldn't recover until the next sign-in
// (this actually happened — notifications stayed silent for nearly a week). Startup handling
// has since moved to Task Scheduler; any leftover registration from an older version is
// removed automatically on startup to avoid launching the app twice.
export const AUTOLAUNCH_REGISTRY_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const AUTOLAUNCH_VALUE_NAME = "TokenRecoveryNotifier";

// Task that launches the app at logon.
// Creating a Task Scheduler task with an ONLOGON trigger via schtasks requires administrator
// privileges (a standard user gets "Access is denied"), so it's registered via
// "Start-Process -Verb RunAs" to trigger a UAC prompt (either on first launch or from the
// tray menu).
export const AUTOLAUNCH_LOGON_TASK_NAME = "TokenRecoveryNotifier";

// Location of the VBScript launcher used to start node.exe with no visible window at all.
// (Registering node.exe directly as the task action would show a console window on every
// launch, and accidentally closing it would kill the resident app, so this VBScript is used
// as a hidden-launch relay.)
export const AUTOLAUNCH_LAUNCHER_SCRIPT_PATH = path.join(
  os.homedir(),
  ".token-recovery-notifier",
  "launcher.vbs"
);

// Location of the PowerShell script used to register the logon-time task with UAC elevation.
export const AUTOLAUNCH_ELEVATE_SCRIPT_PATH = path.join(
  os.homedir(),
  ".token-recovery-notifier",
  "register-logon-task.ps1"
);
