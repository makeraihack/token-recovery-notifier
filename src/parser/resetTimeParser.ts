import { logger } from "../logger";

const RESET_TEXT_PATTERN =
  /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(Etc\/GMT([+-]\d{1,2})\)/i;

/**
 * "Etc/GMT-9" のようなPOSIX慣習の符号反転オフセット表記を、
 * そのゾーンの「UTCからの分オフセット」に変換する（決め打ち禁止、PLAN.mdリスク3対応）。
 * 例: "Etc/GMT-9" → ローカル時刻はUTC+9 → +540分
 *     "Etc/GMT+5" → ローカル時刻はUTC-5 → -300分
 */
export function parseEtcGmtOffsetMinutes(etcGmtSignedHours: string): number {
  const hours = Number.parseInt(etcGmtSignedHours, 10);
  if (Number.isNaN(hours)) {
    throw new Error(`Etc/GMTオフセットの数値解析に失敗しました: ${etcGmtSignedHours}`);
  }
  return -hours * 60;
}

function to24Hour(hour12: number, meridiem: string): number {
  const isPm = meridiem.toLowerCase() === "pm";
  const normalized = hour12 % 12; // 12am/12pm -> 0
  return isPm ? normalized + 12 : normalized;
}

/**
 * "You've hit your session limit · resets 11pm (Etc/GMT-9)" のようなテキストから、
 * 次に到来するその時刻(UTC epoch)を算出する。
 * 時刻のみで日付情報を含まないメッセージ形式のため、「基準時刻以降で直近のその時刻」を採用する
 * （セッション(5時間)上限であれば必ず24時間以内に収まる）。
 *
 * 未知のフォーマットの場合は例外を投げず null を返し、呼び出し側で警告ログを出す。
 */
export function parseResetTimeText(text: string, referenceNow: Date = new Date()): Date | null {
  const match = text.match(RESET_TEXT_PATTERN);
  if (!match) {
    logger.warn(`リセット時刻テキストのパースに失敗しました（フォーマット不一致の可能性）: "${text}"`);
    return null;
  }

  const [, hourStr, minuteStr, meridiem, offsetStr] = match;
  const hour24 = to24Hour(Number.parseInt(hourStr, 10), meridiem);
  const minute = minuteStr ? Number.parseInt(minuteStr, 10) : 0;

  let offsetMinutes: number;
  try {
    offsetMinutes = parseEtcGmtOffsetMinutes(offsetStr);
  } catch (err) {
    logger.warn(`タイムゾーンオフセットのパースに失敗しました: "${text}" (${(err as Error).message})`);
    return null;
  }

  const nowMs = referenceNow.getTime();
  const shifted = new Date(nowMs + offsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();

  const candidateShiftedMs = Date.UTC(y, m, d, hour24, minute, 0, 0);
  let candidateUtcMs = candidateShiftedMs - offsetMinutes * 60_000;

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (candidateUtcMs <= nowMs) {
    candidateUtcMs += ONE_DAY_MS;
  }

  return new Date(candidateUtcMs);
}
