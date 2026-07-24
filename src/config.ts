import os from "node:os";
import path from "node:path";

export const APP_NAME = "Token Recovery Notifier";

// Claude Code CLIがセッションtranscriptを書き出すディレクトリ（非公式・要監視対象）
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// jsonl/subagentのjsonlを両方対象にする
export const JSONL_GLOB = "**/*.jsonl";

// tail読み取りのポーリング間隔補助（fs.watchのfsイベントを主とし、これは保険のポーリング）
export const WATCH_POLL_INTERVAL_MS = 3000;

// アプリ起動時、各ファイルの「末尾から何バイトを遡って直近のrate_limitイベントを
// スキャンするか」の上限。transcriptは数万行規模になり得るため全体走査は避け、
// 起動直前に発生した(まだリセットされていない可能性がある)直近のイベントのみを
// 対象にする。あるレート制限イベントがまだ有効(リセット未到来)なら、CLIはその後
// 正常な応答を書き込めないため、当該イベントは実質的にファイル末尾付近に位置する。
export const STARTUP_SCAN_MAX_BYTES = 256 * 1024;

export const LOG_FILE_PATH = path.join(os.homedir(), ".token-recovery-notifier", "app.log");

export const AUTOLAUNCH_REGISTRY_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const AUTOLAUNCH_VALUE_NAME = "TokenRecoveryNotifier";
