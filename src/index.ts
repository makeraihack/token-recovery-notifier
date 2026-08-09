import { APP_NAME } from "./config";
import { logger } from "./logger";
import { parseResetTimeText } from "./parser/resetTimeParser";
import { NotificationScheduler } from "./scheduler/notificationScheduler";
import { sendResetNotification } from "./notifier/toastNotifier";
import { sendSlackResetNotification } from "./notifier/slackNotifier";
import { enableAutoLaunch, requestLogonTaskRegistration } from "./startup/autoLaunch";
import { TrayIcon } from "./tray/tray";
import { ProjectsWatcher } from "./watcher/projectsWatcher";

logger.info(`Starting ${APP_NAME}`);

const scheduler = new NotificationScheduler(({ resetAt, kind }) => {
  logger.info(`Reached reset time ${resetAt.toISOString()}, sending notification (kind: ${kind})`);
  sendResetNotification(kind);
  sendSlackResetNotification(kind);
});

const watcher = new ProjectsWatcher((event) => {
  logger.info(`Detected a rate-limit hit: "${event.rawText}" (${event.sourceFile})`);
  const resetAt = parseResetTimeText(event.rawText, event.detectedAt);
  if (!resetAt) return;
  scheduler.schedule(resetAt, event.kind);
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Shutting down ${APP_NAME}`);
  watcher.stop();
  tray.stop();
  process.exit(0);
}

const tray = new TrayIcon({
  onExitRequested: () => {
    logger.info("Exit was requested from the tray menu");
    shutdown();
  },
  onRegisterLogonTaskRequested: () => {
    logger.info("Logon-time startup task registration was requested from the tray menu");
    requestLogonTaskRegistration();
  },
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Since this is a resident app, log any unexpected exception as a last resort so the whole
// process doesn't die silently and unexpectedly
process.on("uncaughtException", (err) => {
  logger.error(`An uncaught exception occurred: ${err.stack ?? err.message}`);
});
process.on("unhandledRejection", (reason) => {
  logger.error(`An unhandled promise rejection occurred: ${String(reason)}`);
});

enableAutoLaunch();
tray.start();
void watcher.start();
