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
      logger.warn(`Config file is malformed (${USER_CONFIG_FILE_PATH}): not a JSON object`);
      return {};
    }
    return parsed as UserConfig;
  } catch (err) {
    logger.warn(
      `Failed to read config file (${USER_CONFIG_FILE_PATH}): ${err instanceof Error ? err.message : String(err)}`
    );
    return {};
  }
}

/** Loads the user config file (reads the file once, then returns a cached value). */
export function loadUserConfig(): UserConfig {
  if (cachedConfig === null) {
    cachedConfig = readConfigFile();
  }
  return cachedConfig;
}

/** Returns the Slack webhook URL, or undefined if unset (logs a one-time notice in that case). */
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
    `Slack notifications are disabled because no Slack webhook URL is configured. To enable them, create ${USER_CONFIG_FILE_PATH} (e.g. { "slackWebhookUrl": "https://hooks.slack.com/services/..." })`
  );
}
