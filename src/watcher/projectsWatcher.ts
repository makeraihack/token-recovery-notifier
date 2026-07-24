import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CLAUDE_PROJECTS_DIR, WATCH_POLL_INTERVAL_MS } from "../config";
import { logger } from "../logger";
import { parseRateLimitLine, type RateLimitEvent } from "../parser/rateLimitParser";
import { TailReader } from "./tailReader";

export type RateLimitEventHandler = (event: RateLimitEvent) => void;

async function listJsonlFiles(root: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(root, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(entry.parentPath ?? root, entry.name));
}

/**
 * `~/.claude/projects/**\/*.jsonl` を横断監視し、新規追記行から
 * レート制限ヒットを検知する。監視対象ディレクトリの動的な増減
 * (プロジェクト追加/セッション新規作成)に追従する。
 */
export class ProjectsWatcher {
  private readonly tailReader = new TailReader();
  private readonly trackedFiles = new Set<string>();
  private fsWatcher: fs.FSWatcher | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly onRateLimitEvent: RateLimitEventHandler) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.tryAttachWatcher();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, WATCH_POLL_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.fsWatcher?.close();
    this.fsWatcher = null;
  }

  private async tryAttachWatcher(): Promise<void> {
    if (this.fsWatcher || this.stopped) return;

    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
      logger.warn(
        `監視対象ディレクトリがまだ存在しません（Claude Codeが未実行の可能性）: ${CLAUDE_PROJECTS_DIR}。定期的に再確認します。`
      );
      return;
    }

    try {
      this.fsWatcher = fs.watch(
        CLAUDE_PROJECTS_DIR,
        { recursive: true, persistent: true },
        (_eventType, filename) => {
          if (!filename || !filename.toString().endsWith(".jsonl")) return;
          const fullPath = path.join(CLAUDE_PROJECTS_DIR, filename.toString());
          void this.processFile(fullPath);
        }
      );
      this.fsWatcher.on("error", (err) => {
        logger.error(`ファイル監視中にエラーが発生しました: ${(err as Error).message}`);
      });
      logger.info(`監視を開始しました: ${CLAUDE_PROJECTS_DIR}`);
      await this.reconcile();
    } catch (err) {
      logger.error(`fs.watchの開始に失敗しました: ${(err as Error).message}`);
      this.fsWatcher = null;
    }
  }

  /**
   * fs.watchの取りこぼし(深い階層でのイベント欠落等)に備えた保険のポーリング。
   * 監視ディレクトリが後から作成された場合の再アタッチもここで行う。
   */
  private async reconcile(): Promise<void> {
    if (this.stopped) return;
    if (!this.fsWatcher) {
      await this.tryAttachWatcher();
      return;
    }

    const files = await listJsonlFiles(CLAUDE_PROJECTS_DIR);
    const currentSet = new Set(files);

    for (const filePath of files) {
      this.trackedFiles.add(filePath);
      await this.processFile(filePath);
    }

    for (const tracked of this.trackedFiles) {
      if (!currentSet.has(tracked)) {
        this.trackedFiles.delete(tracked);
        this.tailReader.forget(tracked);
        logger.info(`監視対象ファイルが削除されたため追跡を停止しました: ${tracked}`);
      }
    }
  }

  private async processFile(filePath: string): Promise<void> {
    this.trackedFiles.add(filePath);
    let newLines: string[];
    try {
      newLines = await this.tailReader.readNewLines(filePath);
    } catch (err) {
      logger.error(`tail読み取り中にエラーが発生しました: ${filePath} (${(err as Error).message})`);
      return;
    }

    for (const line of newLines) {
      let event: RateLimitEvent | null;
      try {
        event = parseRateLimitLine(line, filePath);
      } catch (err) {
        logger.warn(`行の解析中に予期しないエラーが発生しました: ${filePath} (${(err as Error).message})`);
        continue;
      }
      if (event) {
        this.onRateLimitEvent(event);
      }
    }
  }
}
