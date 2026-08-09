import { logger } from "../logger";
import type { RateLimitKind } from "../parser/rateLimitParser";

export interface NotificationFireInfo {
  resetAt: Date;
  kind: RateLimitKind;
}

export type NotificationFireHandler = (info: NotificationFireInfo) => void;

// setTimeout's maximum delay (signed 32-bit integer, roughly 24.8 days)
const MAX_TIMEOUT_DELAY_MS = 2 ** 31 - 1;

/**
 * Registers a notification timer per reset time.
 * If the same reset time (= the same rate-limit event) is detected redundantly from both
 * the main session transcript and a subagent transcript, de-duplicates by reset time so it
 * doesn't fire twice.
 */
export class NotificationScheduler {
  private readonly scheduledResetTimes = new Set<number>();

  constructor(private readonly onFire: NotificationFireHandler) {}

  schedule(resetAt: Date, kind: RateLimitKind): void {
    const key = resetAt.getTime();

    if (key <= Date.now()) {
      // This may be a past event, already reset, found during the startup backlog scan.
      // Firing an immediate notification for a past time would be a false alarm, so don't schedule it.
      logger.info(`Reset time ${resetAt.toISOString()} has already passed, so no notification will be scheduled`);
      return;
    }

    if (this.scheduledResetTimes.has(key)) {
      logger.info(`A notification for reset time ${resetAt.toISOString()} is already scheduled, skipping`);
      return;
    }

    this.scheduledResetTimes.add(key);
    const delayMs = Math.max(key - Date.now(), 0);
    this.armTimeout(delayMs, () => {
      this.scheduledResetTimes.delete(key);
      this.onFire({ resetAt, kind });
    });
    logger.info(`Scheduled a notification: ${resetAt.toISOString()} (kind: ${kind}, in ${Math.round(delayMs / 60000)} min)`);
  }

  private armTimeout(remainingMs: number, onDue: () => void): void {
    if (remainingMs <= MAX_TIMEOUT_DELAY_MS) {
      setTimeout(onDue, remainingMs);
      return;
    }
    setTimeout(() => this.armTimeout(remainingMs - MAX_TIMEOUT_DELAY_MS, onDue), MAX_TIMEOUT_DELAY_MS);
  }
}
