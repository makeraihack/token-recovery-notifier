import fs from "node:fs";
import path from "node:path";
import { LOG_FILE_PATH, LOG_MAX_SIZE_BYTES } from "./config";

type LogLevel = "info" | "warn" | "error";

function ensureLogDir(): void {
  const dir = path.dirname(LOG_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Rotates app.log to app.log.1 once it crosses LOG_MAX_SIZE_BYTES, keeping a single backup.
 * Best-effort: if rotation itself fails (e.g. a transient file lock), logging just continues
 * appending to the current file rather than blocking or throwing.
 */
function rotateIfNeeded(): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(LOG_FILE_PATH);
  } catch {
    return; // No log file yet, nothing to rotate
  }
  if (stat.size < LOG_MAX_SIZE_BYTES) return;

  try {
    const rotatedPath = `${LOG_FILE_PATH}.1`;
    fs.rmSync(rotatedPath, { force: true });
    fs.renameSync(LOG_FILE_PATH, rotatedPath);
  } catch {
    // Best-effort rotation; keep appending to the current file if it fails
  }
}

function write(level: LogLevel, message: string): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
  try {
    ensureLogDir();
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE_PATH, line + "\n");
  } catch {
    // A failure to write the log file should never stop the app itself
  }
}

export const logger = {
  info: (message: string) => write("info", message),
  warn: (message: string) => write("warn", message),
  error: (message: string) => write("error", message),
};
