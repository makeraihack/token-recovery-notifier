import http from "node:http";
import https from "node:https";
import { APP_NAME } from "../config";
import { logger } from "../logger";
import type { RateLimitKind } from "../parser/rateLimitParser";
import { getSlackWebhookUrl } from "../userConfig";

function labelFor(kind: RateLimitKind): string {
  if (kind === "weekly") return "週次";
  if (kind === "session") return "セッション";
  return "";
}

function buildMessageText(kind: RateLimitKind): string {
  const label = labelFor(kind);
  return label
    ? `[${APP_NAME}] Claude Codeの${label}利用上限がリセットされました。作業を再開できます。`
    : `[${APP_NAME}] Claude Codeの利用上限がリセットされました。作業を再開できます。`;
}

function postJson(webhookUrl: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(webhookUrl);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // ローカル検証用のhttpサーバーにも対応できるよう、プロトコルに応じてモジュールを切り替える
    const transport = url.protocol === "http:" ? http : https;

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Slack Webhookが失敗ステータスを返しました: ${statusCode}`));
        }
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Slack Incoming Webhook経由でリセットを知らせる。Webhook URL未設定時は何もしない(呼び出し元でエラー扱いしない)。
 * 送信失敗はログに残すのみで、アプリ本体は落とさない。
 */
export function sendSlackResetNotification(kind: RateLimitKind): void {
  const webhookUrl = getSlackWebhookUrl();
  if (!webhookUrl) return;

  const text = buildMessageText(kind);
  const body = JSON.stringify({ text });

  postJson(webhookUrl, body).catch((err) => {
    logger.error(`Slack通知の送信に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
  });
}
