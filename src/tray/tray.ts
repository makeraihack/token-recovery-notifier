import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { logger } from "../logger";

type TrayChildProcess = ChildProcessByStdio<null, Readable, Readable>;

// Escapes single quotes for embedding inside a PowerShell single-quoted string ( ' -> '' )
function psSingleQuote(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Encodes tray.ps1 as UTF-16LE + Base64 and passes it via `-EncodedCommand`.
 * PowerShell 5.1 can misread a BOM-less UTF-8 .ps1 file using the system ANSI code page
 * (e.g. cp932), which has been observed to cause parse errors with non-ASCII comments or
 * strings. -EncodedCommand is always UTF-16LE and is passed as raw bytes directly from
 * Node, so it sidesteps encoding-detection issues when the file is read.
 *
 * powershell.exe also rejects any extra trailing command-line arguments once -EncodedCommand
 * is used ("a command has already been specified"), so runtime values like the icon path
 * can't be passed as $args — instead the placeholder token in tray.ps1 is substituted here
 * before encoding.
 */
const ICON_PATH_PLACEHOLDER = "%%TRAY_ICON_PATH%%";

function buildEncodedCommand(scriptPath: string, iconPath: string): string {
  const rawContent = fs.readFileSync(scriptPath, "utf8").replace(/^﻿/, "");
  if (!rawContent.includes(ICON_PATH_PLACEHOLDER)) {
    // Fail loudly rather than silently falling back to the default icon (this exact bug
    // happened once already when the placeholder text also appeared in a comment, so
    // String.replace's "first match" semantics substituted the comment instead of the code).
    throw new Error(`tray.ps1 is missing the ${ICON_PATH_PLACEHOLDER} placeholder`);
  }
  const scriptContent = rawContent.replace(ICON_PATH_PLACEHOLDER, psSingleQuote(iconPath));
  return Buffer.from(scriptContent, "utf16le").toString("base64");
}

const CLIXML_HEADER_PATTERN = /^#<\s*CLIXML\s*/i;

/**
 * When run with -NonInteractive and piped output, PowerShell can write just a "#< CLIXML"
 * header to stderr even when there's no actual error content (harmless, expected behavior).
 * Returns true if what remains after stripping the header is empty (treated as noise).
 * Returns false if real error content follows (e.g. `<S S="Error">...`), which is still
 * treated as a warning.
 */
export function isCliXmlHeaderOnly(text: string): boolean {
  return text.replace(CLIXML_HEADER_PATTERN, "").trim().length === 0;
}

export interface TrayIconHandlers {
  onExitRequested: () => void;
  onRegisterLogonTaskRequested: () => void;
}

/** Shows the tray icon via PowerShell (System.Windows.Forms.NotifyIcon). */
export class TrayIcon {
  private child: TrayChildProcess | null = null;

  constructor(private readonly handlers: TrayIconHandlers) {}

  start(): void {
    const scriptPath = path.join(__dirname, "tray.ps1");
    const iconPath = path.join(__dirname, "icon.ico");
    let encodedCommand: string;
    try {
      encodedCommand = buildEncodedCommand(scriptPath, iconPath);
    } catch (err) {
      logger.error(`Failed to load the tray script: ${(err as Error).message}`);
      return;
    }

    try {
      this.child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (err) {
      logger.error(`Failed to launch the tray icon: ${(err as Error).message}`);
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
      logger.warn(`Standard error output from the tray process: ${text.trim()}`);
    });
    this.child.on("error", (err) => {
      logger.error(`An error occurred in the tray process: ${err.message}`);
    });
    this.child.on("exit", (code) => {
      logger.info(`The tray icon process exited (code=${code})`);
      this.child = null;
    });
    logger.info("Started the tray icon");
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}
