import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CLAUDE_PROJECTS_DIR, STARTUP_SCAN_MAX_BYTES, WATCH_POLL_INTERVAL_MS } from "../config";
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
 * Watches `~/.claude/projects/**\/*.jsonl` across all projects and detects rate-limit hits
 * from newly appended lines. Follows dynamic changes to the watched directory (new projects
 * added, new sessions created).
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
        `The watched directory doesn't exist yet (Claude Code may not have run yet): ${CLAUDE_PROJECTS_DIR}. Will keep checking periodically.`
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
        logger.error(`An error occurred while watching files: ${(err as Error).message}`);
      });
      logger.info(`Started watching: ${CLAUDE_PROJECTS_DIR}`);
      await this.reconcile();
    } catch (err) {
      logger.error(`Failed to start fs.watch: ${(err as Error).message}`);
      this.fsWatcher = null;
    }
  }

  /**
   * Fallback polling in case fs.watch misses events (e.g. events dropped in deeply nested
   * paths). Also handles re-attaching if the watched directory is created later.
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
        logger.info(`Watched file was deleted, stopped tracking it: ${tracked}`);
      }
    }
  }

  private async processFile(filePath: string): Promise<void> {
    this.trackedFiles.add(filePath);
    const isFirstEncounter = !this.tailReader.hasState(filePath);
    let newLines: string[];
    try {
      newLines = isFirstEncounter
        ? await this.tailReader.scanTailForBaseline(filePath, STARTUP_SCAN_MAX_BYTES)
        : await this.tailReader.readNewLines(filePath);
    } catch (err) {
      logger.error(`An error occurred while tail-reading: ${filePath} (${(err as Error).message})`);
      return;
    }

    for (const line of newLines) {
      let event: RateLimitEvent | null;
      try {
        event = parseRateLimitLine(line, filePath);
      } catch (err) {
        logger.warn(`An unexpected error occurred while parsing a line: ${filePath} (${(err as Error).message})`);
        continue;
      }
      if (event) {
        this.onRateLimitEvent(event);
      }
    }
  }
}
