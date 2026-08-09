import notifier from "node-notifier";
import { APP_NAME } from "../config";
import { logger } from "../logger";
import type { RateLimitKind } from "../parser/rateLimitParser";

function labelFor(kind: RateLimitKind): string {
  if (kind === "weekly") return "weekly";
  if (kind === "session") return "session";
  return "";
}

/** Notifies about a reset via a Windows toast (Action Center) notification. Does not rely on any external push notification service. */
export function sendResetNotification(kind: RateLimitKind): void {
  const label = labelFor(kind);
  const message = label
    ? `Your Claude Code ${label} usage limit has reset. You can resume working.`
    : "Your Claude Code usage limit has reset. You can resume working.";

  notifier.notify(
    {
      title: APP_NAME,
      message,
      sound: true,
    },
    (err) => {
      if (err) {
        logger.error(`Failed to send toast notification: ${err.message}`);
      }
    }
  );
}
