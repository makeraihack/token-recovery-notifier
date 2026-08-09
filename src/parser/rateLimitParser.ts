import { logger } from "../logger";

export type RateLimitKind = "session" | "weekly" | "unknown";

export interface RateLimitEvent {
  kind: RateLimitKind;
  /** Raw text of the synthetic message (e.g. "You've hit your session limit · resets 11pm (Etc/GMT-9)") */
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
 * Uses the time the line itself was recorded (the transcript's "timestamp" field).
 * When scanning the backlog at startup, the reset text must be interpreted relative to
 * the time the message was actually recorded, not the moment it happens to be read —
 * otherwise a past event can be misjudged as a future one (the "resets" text carries a
 * time only, no date).
 */
function resolveDetectedAt(line: TranscriptLine, sourceFile: string): Date {
  if (line.timestamp) {
    const parsed = new Date(line.timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  logger.warn(
    `Could not read the timestamp field, so the current time is being used as the detected time instead (possible format mismatch): ${sourceFile}`
  );
  return new Date();
}

function extractText(line: TranscriptLine): string | null {
  const content = line.message?.content;
  if (!Array.isArray(content)) return null;
  const textPart = content.find((part) => part && part.type === "text" && typeof part.text === "string");
  return textPart?.text ?? null;
}

// A real example of the weekly message was confirmed against live data on 2026-07-29
// ("You've hit your weekly limit · resets Aug 1, 10pm (Etc/GMT-9)"). Unlike the session
// limit, it's prefixed with a month name + day, which resetTimeParser already handles.
function classifyKind(text: string): RateLimitKind {
  const lower = text.toLowerCase();
  if (lower.includes("week")) return "weekly";
  if (lower.includes("session")) return "session";
  return "unknown";
}

/**
 * Parses a single line (a JSON string) from a transcript jsonl file and extracts it if it's
 * a synthetic rate-limit message. A format mismatch returns null rather than throwing; the
 * caller is responsible for logging a warning.
 */
export function parseRateLimitLine(rawLine: string, sourceFile: string): RateLimitEvent | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;

  let parsed: TranscriptLine;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Likely an incomplete line still being written while tailing, so ignore silently instead of warning
    return null;
  }

  const isRateLimitError = parsed.error === "rate_limit" && parsed.isApiErrorMessage === true;
  if (!isRateLimitError) return null;

  const text = extractText(parsed);
  if (!text) {
    logger.warn(
      `Found a line flagged as rate_limit but couldn't extract its text (possible format mismatch): ${sourceFile}`
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
