import { logger } from "../logger";
import type { RateLimitKind } from "../parser/rateLimitParser";

export interface NotificationFireInfo {
  resetAt: Date;
  kind: RateLimitKind;
}

export type NotificationFireHandler = (info: NotificationFireInfo) => void;

// setTimeoutの最大遅延(32bit符号付き整数, 約24.8日)
const MAX_TIMEOUT_DELAY_MS = 2 ** 31 - 1;

/**
 * リセット時刻ごとに通知タイマーを登録する。
 * 同一のリセット時刻(=同一のレート制限イベント)がメインセッションとsubagentの
 * 両方のtranscriptから重複検知された場合でも、二重通知しないようにリセット時刻で重複排除する。
 */
export class NotificationScheduler {
  private readonly scheduledResetTimes = new Set<number>();

  constructor(private readonly onFire: NotificationFireHandler) {}

  schedule(resetAt: Date, kind: RateLimitKind): void {
    const key = resetAt.getTime();

    if (key <= Date.now()) {
      // 起動時バックログスキャンで見つかった、既にリセット済みの過去のイベントの可能性がある。
      // 過去時刻へ即時通知してしまうと誤発火になるためスケジュールしない。
      logger.info(`リセット時刻 ${resetAt.toISOString()} は既に過ぎているため通知をスケジュールしません`);
      return;
    }

    if (this.scheduledResetTimes.has(key)) {
      logger.info(`リセット時刻 ${resetAt.toISOString()} への通知は既に予約済みのためスキップします`);
      return;
    }

    this.scheduledResetTimes.add(key);
    const delayMs = Math.max(key - Date.now(), 0);
    this.armTimeout(delayMs, () => {
      this.scheduledResetTimes.delete(key);
      this.onFire({ resetAt, kind });
    });
    logger.info(`通知を予約しました: ${resetAt.toISOString()} (種別: ${kind}, ${Math.round(delayMs / 60000)}分後)`);
  }

  private armTimeout(remainingMs: number, onDue: () => void): void {
    if (remainingMs <= MAX_TIMEOUT_DELAY_MS) {
      setTimeout(onDue, remainingMs);
      return;
    }
    setTimeout(() => this.armTimeout(remainingMs - MAX_TIMEOUT_DELAY_MS, onDue), MAX_TIMEOUT_DELAY_MS);
  }
}
