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
  message?: {
    content?: Array<{ type?: string; text?: string }>;
  };
}

function extractText(line: TranscriptLine): string | null {
  const content = line.message?.content;
  if (!Array.isArray(content)) return null;
  const textPart = content.find((part) => part && part.type === "text" && typeof part.text === "string");
  return textPart?.text ?? null;
}

// PLAN.mdの技術調査結果より、週次メッセージの実例は未確認。
// "week"を含むかどうかで暫定的に種別分岐し、実例判明時にここへパターンを追加できるようにする。
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
    detectedAt: new Date(),
    sourceFile,
  };
}
