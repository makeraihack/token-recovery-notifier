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

// Slack Webhook URLなどユーザー固有の設定を置くファイル(任意・未設定でも動作する)
export const USER_CONFIG_FILE_PATH = path.join(os.homedir(), ".token-recovery-notifier", "config.json");

// 旧バージョンで使っていたレジストリRunキー。「ログイン時に一度だけ起動を試みる」だけで、
// クラッシュや強制終了で落ちた後は次回ログインまで復旧しない欠点が実際に起きた
// (通知が一週間近く止まっていた)ため、タスクスケジューラ管理へ移行した。
// 過去バージョンの登録が残っていれば起動時に自動で削除する(二重起動防止)。
export const AUTOLAUNCH_REGISTRY_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const AUTOLAUNCH_VALUE_NAME = "TokenRecoveryNotifier";

// ログオン時にアプリ本体を起動するタスク。
// schtasksでのONLOGONトリガー作成には管理者権限が必要(通常権限だとAccess is denied)なため、
// 「Start-Process -Verb RunAs」でUACダイアログを出して登録する(初回起動時 or タスクトレイメニューから)。
export const AUTOLAUNCH_LOGON_TASK_NAME = "TokenRecoveryNotifier";

// 自動起動時、ウィンドウを一切表示せずnode.exeを起動するためのVBScriptランチャーの保存先。
// (直接node.exeをタスクに登録すると、起動毎にコンソールウィンドウが表示され、
// 誤って閉じられると常駐が止まってしまうため、非表示起動の中継役として使う)
export const AUTOLAUNCH_LAUNCHER_SCRIPT_PATH = path.join(
  os.homedir(),
  ".token-recovery-notifier",
  "launcher.vbs"
);

// ログオン時起動タスクをUAC昇格つきで登録するためのPowerShellスクリプトの保存先。
export const AUTOLAUNCH_ELEVATE_SCRIPT_PATH = path.join(
  os.homedir(),
  ".token-recovery-notifier",
  "register-logon-task.ps1"
);
