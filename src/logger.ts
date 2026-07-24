import fs from "node:fs";
import path from "node:path";
import { LOG_FILE_PATH } from "./config";

type LogLevel = "info" | "warn" | "error";

function ensureLogDir(): void {
  const dir = path.dirname(LOG_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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
    fs.appendFileSync(LOG_FILE_PATH, line + "\n");
  } catch {
    // ログファイルへの書き込み失敗はアプリ本体の動作を止めない
  }
}

export const logger = {
  info: (message: string) => write("info", message),
  warn: (message: string) => write("warn", message),
  error: (message: string) => write("error", message),
};
