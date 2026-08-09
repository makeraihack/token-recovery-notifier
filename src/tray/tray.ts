import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { logger } from "../logger";

type TrayChildProcess = ChildProcessByStdio<null, Readable, Readable>;

/**
 * tray.ps1をUTF-16LE+Base64にエンコードし `-EncodedCommand` で渡す。
 * PowerShell 5.1は、BOM無しUTF-8の.ps1をシステムのANSIコードページ(cp932等)で
 * 誤読することがあり、日本語コメント/文字列でパースエラーになる実例が確認されている。
 * -EncodedCommandはUTF-16LE固定でNode側からバイト列を直接渡すため、
 * ファイル読み込み時のエンコーディング推定に依存せず問題を回避できる。
 */
function buildEncodedCommand(scriptPath: string): string {
  const scriptContent = fs.readFileSync(scriptPath, "utf8").replace(/^﻿/, "");
  return Buffer.from(scriptContent, "utf16le").toString("base64");
}

const CLIXML_HEADER_PATTERN = /^#<\s*CLIXML\s*/i;

/**
 * PowerShellは-NonInteractive+パイプ実行時、エラーストリームが空でも
 * "#< CLIXML" ヘッダーだけを標準エラーへ書き出すことがある(実害のない正常動作)。
 * ヘッダーを取り除いた残りが空ならノイズとみなしtrueを返す。
 * 実際のエラー内容(例: `<S S="Error">...`)が続く場合はfalseを返し、警告扱いを維持する。
 */
export function isCliXmlHeaderOnly(text: string): boolean {
  return text.replace(CLIXML_HEADER_PATTERN, "").trim().length === 0;
}

export interface TrayIconHandlers {
  onExitRequested: () => void;
  onRegisterLogonTaskRequested: () => void;
}

/** PowerShell(System.Windows.Forms.NotifyIcon)でタスクトレイアイコンを表示する。 */
export class TrayIcon {
  private child: TrayChildProcess | null = null;

  constructor(private readonly handlers: TrayIconHandlers) {}

  start(): void {
    const scriptPath = path.join(__dirname, "tray.ps1");
    let encodedCommand: string;
    try {
      encodedCommand = buildEncodedCommand(scriptPath);
    } catch (err) {
      logger.error(`タスクトレイスクリプトの読み込みに失敗しました: ${(err as Error).message}`);
      return;
    }

    try {
      this.child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (err) {
      logger.error(`タスクトレイアイコンの起動に失敗しました: ${(err as Error).message}`);
      return;
    }

    this.child.stdout.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      if (text.includes("EXIT")) {
        this.handlers.onExitRequested();
      }
      if (text.includes("REGISTER_LOGON_TASK")) {
        this.handlers.onRegisterLogonTaskRequested();
      }
    });
    this.child.stderr.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      if (isCliXmlHeaderOnly(text)) return;
      logger.warn(`タスクトレイプロセスの標準エラー出力: ${text.trim()}`);
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
