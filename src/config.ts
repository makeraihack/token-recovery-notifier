import os from "node:os";
import path from "node:path";

export const APP_NAME = "Token Recovery Notifier";

// Claude Code CLIがセッションtranscriptを書き出すディレクトリ（非公式・要監視対象）
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// jsonl/subagentのjsonlを両方対象にする
export const JSONL_GLOB = "**/*.jsonl";

// tail読み取りのポーリング間隔補助（chokidarのfsイベントを主とし、これは保険のポーリング）
export const WATCH_POLL_INTERVAL_MS = 3000;

export const LOG_FILE_PATH = path.join(os.homedir(), ".token-recovery-notifier", "app.log");

export const AUTOLAUNCH_REGISTRY_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const AUTOLAUNCH_VALUE_NAME = "TokenRecoveryNotifier";
