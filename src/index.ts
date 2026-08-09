import { APP_NAME } from "./config";
import { logger } from "./logger";
import { parseResetTimeText } from "./parser/resetTimeParser";
import { NotificationScheduler } from "./scheduler/notificationScheduler";
import { sendResetNotification } from "./notifier/toastNotifier";
import { sendSlackResetNotification } from "./notifier/slackNotifier";
import { enableAutoLaunch, requestLogonTaskRegistration } from "./startup/autoLaunch";
import { TrayIcon } from "./tray/tray";
import { ProjectsWatcher } from "./watcher/projectsWatcher";

logger.info(`${APP_NAME} を起動します`);

const scheduler = new NotificationScheduler(({ resetAt, kind }) => {
  logger.info(`リセット時刻 ${resetAt.toISOString()} に到達したため通知します（種別: ${kind}）`);
  sendResetNotification(kind);
  sendSlackResetNotification(kind);
});

const watcher = new ProjectsWatcher((event) => {
  logger.info(`レート制限ヒットを検知しました: "${event.rawText}" (${event.sourceFile})`);
  const resetAt = parseResetTimeText(event.rawText, event.detectedAt);
  if (!resetAt) return;
  scheduler.schedule(resetAt, event.kind);
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${APP_NAME} を終了します`);
  watcher.stop();
  tray.stop();
  process.exit(0);
}

const tray = new TrayIcon({
  onExitRequested: () => {
    logger.info("タスクトレイメニューから終了が要求されました");
    shutdown();
  },
  onRegisterLogonTaskRequested: () => {
    logger.info("タスクトレイメニューからログオン時起動タスクの登録が要求されました");
    requestLogonTaskRegistration();
  },
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 常駐アプリのため、想定外の例外で不意にプロセス全体が落ちないよう最後の砦としてログに残す
process.on("uncaughtException", (err) => {
  logger.error(`未捕捉の例外が発生しました: ${err.stack ?? err.message}`);
});
process.on("unhandledRejection", (reason) => {
  logger.error(`未処理のPromise rejectionが発生しました: ${String(reason)}`);
});

enableAutoLaunch();
tray.start();
void watcher.start();
