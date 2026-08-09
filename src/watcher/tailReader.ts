import fs from "node:fs";
import fsp from "node:fs/promises";
import { logger } from "../logger";

interface FileTailState {
  offset: number;
  pending: string;
}

/**
 * Reads only the newly appended lines from multiple files using an incremental tail.
 * Transcript files can grow to tens of thousands of lines, so a full re-read is never done.
 */
export class TailReader {
  private readonly state = new Map<string, FileTailState>();

  hasState(filePath: string): boolean {
    return this.state.has(filePath);
  }

  /**
   * The first time a file is seen, scans back at most maxScanBytes from the end and returns
   * the complete lines within that range (a one-time backlog scan so a rate_limit event that
   * was already in progress — and possibly not yet reset — when the app started isn't missed).
   * Avoids a full re-read; subsequent reads switch to the incremental tail in readNewLines.
   */
  async scanTailForBaseline(filePath: string, maxScanBytes: number): Promise<string[]> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      logger.warn(`Failed to stat file (it may have been deleted): ${filePath}`);
      return [];
    }

    const start = Math.max(0, stat.size - maxScanBytes);
    const length = stat.size - start;
    if (length <= 0) {
      this.state.set(filePath, { offset: stat.size, pending: "" });
      return [];
    }

    const buffer = Buffer.alloc(length);
    const fh = await fsp.open(filePath, "r");
    try {
      await fh.read(buffer, 0, length, start);
    } finally {
      await fh.close();
    }

    const split = buffer.toString("utf8").split("\n");
    const pending = split.pop() ?? "";
    // If start is greater than 0, the first element is a fragment line that began mid-file, so discard it
    const lines = start > 0 ? split.slice(1) : split;

    this.state.set(filePath, { offset: stat.size, pending });
    return lines;
  }

  async readNewLines(filePath: string): Promise<string[]> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      logger.warn(`Failed to stat file (it may have been deleted): ${filePath}`);
      this.state.delete(filePath);
      return [];
    }

    const current = this.state.get(filePath);
    if (!current) {
      // If readNewLines is called before a baseline exists (an unexpected call order),
      // still avoid a full re-read and just set the baseline. Backlog scanning is
      // scanTailForBaseline's responsibility.
      this.state.set(filePath, { offset: stat.size, pending: "" });
      return [];
    }

    if (stat.size < current.offset) {
      logger.warn(`File shrank (possibly rotated or truncated). Re-watching from the start: ${filePath}`);
      current.offset = 0;
      current.pending = "";
    }

    if (stat.size === current.offset) {
      return [];
    }

    const length = stat.size - current.offset;
    const buffer = Buffer.alloc(length);
    const fh = await fsp.open(filePath, "r");
    try {
      await fh.read(buffer, 0, length, current.offset);
    } finally {
      await fh.close();
    }
    current.offset = stat.size;

    const chunk = current.pending + buffer.toString("utf8");
    const lines = chunk.split("\n");
    current.pending = lines.pop() ?? "";
    return lines;
  }

  forget(filePath: string): void {
    this.state.delete(filePath);
  }
}
