import { logger } from "../logger";

// セッション上限: "resets 11pm (Etc/GMT-9)" のように時刻のみ。
// 週次上限: "resets Aug 1, 10pm (Etc/GMT-9)" のように月名+日付が前置される（実データで確認済み）。
// 月名部分はグループ1・2としてオプショナルにし、両方のフォーマットを1つの正規表現でカバーする。
const RESET_TEXT_PATTERN =
  /resets\s+(?:([A-Za-z]{3,9})\s+(\d{1,2}),\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(Etc\/GMT([+-]\d{1,2})\)/i;

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

// 月名+日付が明示されているイベント(週次上限等)の年推定が年またぎでずれた場合の補正しきい値。
// 例: 12月に検知した "Jan 2" は本来翌年だが、同年で組み立てると約1年近く過去になるため、
// これより大きく過去にずれていたら翌年だったと判断してやり直す(決め打ち禁止、PLAN.mdリスク3と同じ考え方)。
const YEAR_ROLLOVER_THRESHOLD_MS = 180 * 24 * 60 * 60 * 1000;

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
 * "You've hit your session limit · resets 11pm (Etc/GMT-9)" (時刻のみ、セッション上限) や
 * "You've hit your weekly limit · resets Aug 1, 10pm (Etc/GMT-9)" (月名+日付付き、週次上限)
 * のようなテキストから、次に到来するその時刻(UTC epoch)を算出する。
 *
 * - 月名+日付が明示されている場合(週次上限): その日付をそのまま使う。年またぎで過去に大きくずれた
 *   場合のみ翌年だったとみなす。
 * - 時刻のみの場合(セッション上限): 日付情報がないため「基準時刻以降で直近のその時刻」を採用する
 *   （セッション(5時間)上限であれば必ず24時間以内に収まるという設計上の前提）。
 *
 * 未知のフォーマットの場合は例外を投げず null を返し、呼び出し側で警告ログを出す。
 */
export function parseResetTimeText(text: string, referenceNow: Date = new Date()): Date | null {
  const match = text.match(RESET_TEXT_PATTERN);
  if (!match) {
    logger.warn(`リセット時刻テキストのパースに失敗しました（フォーマット不一致の可能性）: "${text}"`);
    return null;
  }

  const [, monthName, dayStr, hourStr, minuteStr, meridiem, offsetStr] = match;
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

  if (monthName && dayStr) {
    const monthIndex = MONTH_NAME_TO_INDEX[monthName.toLowerCase()];
    if (monthIndex === undefined) {
      logger.warn(`月名のパースに失敗しました（未知の月名表記の可能性）: "${text}"`);
      return null;
    }
    const day = Number.parseInt(dayStr, 10);

    let candidateShiftedMs = Date.UTC(y, monthIndex, day, hour24, minute, 0, 0);
    let candidateUtcMs = candidateShiftedMs - offsetMinutes * 60_000;

    // 年またぎ補正: 例えば12月に検知した"Jan 2"を同年で組み立てると約1年前になってしまうため、
    // 大きく過去にずれている場合のみ翌年だったとみなしてやり直す。
    if (nowMs - candidateUtcMs > YEAR_ROLLOVER_THRESHOLD_MS) {
      candidateShiftedMs = Date.UTC(y + 1, monthIndex, day, hour24, minute, 0, 0);
      candidateUtcMs = candidateShiftedMs - offsetMinutes * 60_000;
    }

    return new Date(candidateUtcMs);
  }

  const candidateShiftedMs = Date.UTC(y, m, d, hour24, minute, 0, 0);
  let candidateUtcMs = candidateShiftedMs - offsetMinutes * 60_000;

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (candidateUtcMs <= nowMs) {
    candidateUtcMs += ONE_DAY_MS;
  }

  return new Date(candidateUtcMs);
}
