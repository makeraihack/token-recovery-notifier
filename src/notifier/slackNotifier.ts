import http from "node:http";
import https from "node:https";
import { APP_NAME } from "../config";
import { logger } from "../logger";
import type { RateLimitKind } from "../parser/rateLimitParser";
import { getSlackWebhookUrl } from "../userConfig";

function labelFor(kind: RateLimitKind): string {
  if (kind === "weekly") return "weekly";
  if (kind === "session") return "session";
  return "";
}

function buildMessageText(kind: RateLimitKind): string {
  const label = labelFor(kind);
  return label
    ? `[${APP_NAME}] Your Claude Code ${label} usage limit has reset. You can resume working.`
    : `[${APP_NAME}] Your Claude Code usage limit has reset. You can resume working.`;
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

    // Switch transport based on the protocol so a local test http server also works
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
          reject(new Error(`Slack webhook returned a failure status: ${statusCode}`));
        }
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Notifies about a reset via a Slack Incoming Webhook. No-op if no webhook URL is configured
 * (not treated as an error by the caller). A send failure is only logged; it never crashes the app.
 */
export function sendSlackResetNotification(kind: RateLimitKind): void {
  const webhookUrl = getSlackWebhookUrl();
  if (!webhookUrl) return;

  const text = buildMessageText(kind);
  const body = JSON.stringify({ text });

  postJson(webhookUrl, body).catch((err) => {
    logger.error(`Failed to send Slack notification: ${err instanceof Error ? err.message : String(err)}`);
  });
}
