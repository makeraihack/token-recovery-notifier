import { logger } from "../logger";

export type RateLimitKind = "session" | "weekly" | "unknown";

export interface RateLimitEvent {
  kind: RateLimitKind;
  /** 合成メッセージの生テキスト（例: "You've hit your session limit · resets 11pm (Etc/GMT-9)"） */
  rawText: string;
  detectedAt: Date;
  sourceFile: string;
}

interface TranscriptLine {
  type?: string;
  error?: string;
  isApiErrorMessage?: boolean;
  timestamp?: string;
  message?: {
    content?: Array<{ type?: string; text?: string }>;
  };
}

/**
 * 行自体が記録された時刻(transcriptの"timestamp"フィールド)を採用する。
 * 起動時のバックログスキャンでは「読み取った瞬間」ではなく「メッセージが実際に
 * 記録された時刻」を基準にresets時刻を解釈しないと、過去のイベントを未来の
 * イベントとして誤判定してしまう(resetsテキストは時刻のみで日付を含まないため)。
 */
function resolveDetectedAt(line: TranscriptLine, sourceFile: string): Date {
  if (line.timestamp) {
    const parsed = new Date(line.timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  logger.warn(
    `timestampフィールドを取得できなかったため、検知時刻を現在時刻で代用します（フォーマット不一致の可能性）: ${sourceFile}`
  );
  return new Date();
}

function extractText(line: TranscriptLine): string | null {
  const content = line.message?.content;
  if (!Array.isArray(content)) return null;
  const textPart = content.find((part) => part && part.type === "text" && typeof part.text === "string");
  return textPart?.text ?? null;
}

// 週次メッセージの実例は2026-07-29に実データで確認済み（"You've hit your weekly limit · resets Aug 1, 10pm (Etc/GMT-9)"）。
// セッション上限とは異なり月名+日付が前置される点はresetTimeParser側で対応済み。
function classifyKind(text: string): RateLimitKind {
  const lower = text.toLowerCase();
  if (lower.includes("week")) return "weekly";
  if (lower.includes("session")) return "session";
  return "unknown";
}

/**
 * transcript jsonlの1行(JSON文字列)を解析し、合成レート制限メッセージであれば抽出する。
 * フォーマット不一致は例外にせず null を返し、呼び出し側でログ警告する。
 */
export function parseRateLimitLine(rawLine: string, sourceFile: string): RateLimitEvent | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;

  let parsed: TranscriptLine;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // tail読み取り中の未確定行(書き込み途中)の可能性があるため、警告ではなく無視する
    return null;
  }

  const isRateLimitError = parsed.error === "rate_limit" && parsed.isApiErrorMessage === true;
  if (!isRateLimitError) return null;

  const text = extractText(parsed);
  if (!text) {
    logger.warn(
      `rate_limitフラグを持つ行だがテキストを抽出できませんでした（フォーマット不一致の可能性）: ${sourceFile}`
    );
    return null;
  }

  return {
    kind: classifyKind(text),
    rawText: text,
    detectedAt: resolveDetectedAt(parsed, sourceFile),
    sourceFile,
  };
}
