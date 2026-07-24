import notifier from "node-notifier";
import { APP_NAME } from "../config";
import { logger } from "../logger";
import type { RateLimitKind } from "../parser/rateLimitParser";

function labelFor(kind: RateLimitKind): string {
  if (kind === "weekly") return "週次";
  if (kind === "session") return "セッション";
  return "";
}

/** Windows Toast通知(Action Center通知)でリセットを知らせる。外部プッシュ通知サービスには依存しない。 */
export function sendResetNotification(kind: RateLimitKind): void {
  const label = labelFor(kind);
  const message = label
    ? `Claude Codeの${label}利用上限がリセットされました。作業を再開できます。`
    : "Claude Codeの利用上限がリセットされました。作業を再開できます。";

  notifier.notify(
    {
      title: APP_NAME,
      message,
      sound: true,
    },
    (err) => {
      if (err) {
        logger.error(`Toast通知の送信に失敗しました: ${err.message}`);
      }
    }
  );
}
