import fs from "node:fs";
import { USER_CONFIG_FILE_PATH } from "./config";
import { logger } from "./logger";

export interface UserConfig {
  slackWebhookUrl?: string;
}

let cachedConfig: UserConfig | null = null;
let hasWarnedMissingWebhook = false;

function readConfigFile(): UserConfig {
  if (!fs.existsSync(USER_CONFIG_FILE_PATH)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(USER_CONFIG_FILE_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      logger.warn(`設定ファイルの形式が不正です (${USER_CONFIG_FILE_PATH}): JSONオブジェクトではありません`);
      return {};
    }
    return parsed as UserConfig;
  } catch (err) {
    logger.warn(
      `設定ファイルの読み込みに失敗しました (${USER_CONFIG_FILE_PATH}): ${err instanceof Error ? err.message : String(err)}`
    );
    return {};
  }
}

/** ユーザー設定ファイルを読み込む(初回のみファイルアクセスし、以降はキャッシュを返す)。 */
export function loadUserConfig(): UserConfig {
  if (cachedConfig === null) {
    cachedConfig = readConfigFile();
  }
  return cachedConfig;
}

/** Slack Webhook URLを返す。未設定の場合はundefinedを返し、起動後一度だけ案内ログを出す。 */
export function getSlackWebhookUrl(): string | undefined {
  const config = loadUserConfig();
  const url = config.slackWebhookUrl?.trim();
  if (!url) {
    warnMissingWebhookOnce();
    return undefined;
  }
  return url;
}

function warnMissingWebhookOnce(): void {
  if (hasWarnedMissingWebhook) return;
  hasWarnedMissingWebhook = true;
  logger.info(
    `Slack Webhook URLが未設定のためSlack通知は無効です。設定するには ${USER_CONFIG_FILE_PATH} を作成してください（例: { "slackWebhookUrl": "https://hooks.slack.com/services/..." }）`
  );
}
