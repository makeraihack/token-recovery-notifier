import fs from "node:fs";
import fsp from "node:fs/promises";
import { logger } from "../logger";

interface FileTailState {
  offset: number;
  pending: string;
}

/**
 * 複数ファイルの「追記された新しい行のみ」を差分tailで読み取る。
 * transcriptファイルは数万行規模になり得るため、全体再読み込みは行わない。
 */
export class TailReader {
  private readonly state = new Map<string, FileTailState>();

  async readNewLines(filePath: string): Promise<string[]> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      logger.warn(`ファイルのstatに失敗しました（削除された可能性があります）: ${filePath}`);
      this.state.delete(filePath);
      return [];
    }

    const current = this.state.get(filePath);
    if (!current) {
      // 初回検知時は既存の過去ログを遡って処理せず、以降の追記のみを監視対象にする
      this.state.set(filePath, { offset: stat.size, pending: "" });
      return [];
    }

    if (stat.size < current.offset) {
      logger.warn(`ファイルが縮小されていました（ローテーション/切り詰めの可能性）。先頭から再監視します: ${filePath}`);
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
