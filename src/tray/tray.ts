import { spawn, type ChildProcessByStdio } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";
import { logger } from "../logger";

type TrayChildProcess = ChildProcessByStdio<null, Readable, Readable>;

/** PowerShell(System.Windows.Forms.NotifyIcon)でタスクトレイアイコンを表示する。 */
export class TrayIcon {
  private child: TrayChildProcess | null = null;

  constructor(private readonly onExitRequested: () => void) {}

  start(): void {
    const scriptPath = path.join(__dirname, "tray.ps1");
    try {
      this.child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (err) {
      logger.error(`タスクトレイアイコンの起動に失敗しました: ${(err as Error).message}`);
      return;
    }

    this.child.stdout.on("data", (data: Buffer) => {
      if (data.toString("utf8").includes("EXIT")) {
        this.onExitRequested();
      }
    });
    this.child.stderr.on("data", (data: Buffer) => {
      logger.warn(`タスクトレイプロセスの標準エラー出力: ${data.toString("utf8").trim()}`);
    });
    this.child.on("error", (err) => {
      logger.error(`タスクトレイプロセスでエラーが発生しました: ${err.message}`);
    });
    this.child.on("exit", (code) => {
      logger.info(`タスクトレイアイコンのプロセスが終了しました(code=${code})`);
      this.child = null;
    });
    logger.info("タスクトレイアイコンを起動しました");
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}
