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

  hasState(filePath: string): boolean {
    return this.state.has(filePath);
  }

  /**
   * ファイル初回検知時、末尾から最大maxScanBytesバイトだけを遡って走査し、
   * その範囲に含まれる完全な行を返す（アプリ起動時に既に発生していた、まだ
   * リセット前かもしれないrate_limitイベントを取りこぼさないための一度きりの
   * バックログスキャン）。全体再読み込みは避け、以降はreadNewLinesによる
   * 差分tailに切り替わる。
   */
  async scanTailForBaseline(filePath: string, maxScanBytes: number): Promise<string[]> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      logger.warn(`ファイルのstatに失敗しました（削除された可能性があります）: ${filePath}`);
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
    // startが0より大きい場合、先頭要素は任意バイト位置から読み始めた断片行なので破棄する
    const lines = start > 0 ? split.slice(1) : split;

    this.state.set(filePath, { offset: stat.size, pending });
    return lines;
  }

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
      // readNewLinesが先に呼ばれた場合(想定外の呼び出し順)も、全体再読み込みは避けて
      // baselineのみ設定する。バックログスキャンはscanTailForBaselineの責務。
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
