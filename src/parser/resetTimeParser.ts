import { logger } from "../logger";

// Session limit: time only, e.g. "resets 11pm (Etc/GMT-9)".
// Weekly limit: prefixed with a month name + day, e.g. "resets Aug 1, 10pm (Etc/GMT-9)"
// (confirmed against real data). The month/day portion is captured as optional groups 1/2
// so a single regex covers both formats.
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

// Correction threshold for when the estimated year for an event with an explicit month+day
// (e.g. the weekly limit) drifts across a year boundary. Example: detecting "Jan 2" in
// December really means next year; building the date in the same year would put it nearly
// a year in the past. If the drift into the past is larger than this threshold, assume it
// meant next year and rebuild it (never guess blindly — same principle as PLAN.md risk 3).
const YEAR_ROLLOVER_THRESHOLD_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Converts a POSIX-style sign-inverted offset notation like "Etc/GMT-9" into that zone's
 * "minutes offset from UTC" (never guess blindly — this addresses PLAN.md risk 3).
 * Example: "Etc/GMT-9" -> local time is UTC+9 -> +540 minutes
 *          "Etc/GMT+5" -> local time is UTC-5 -> -300 minutes
 */
export function parseEtcGmtOffsetMinutes(etcGmtSignedHours: string): number {
  const hours = Number.parseInt(etcGmtSignedHours, 10);
  if (Number.isNaN(hours)) {
    throw new Error(`Failed to parse the Etc/GMT offset as a number: ${etcGmtSignedHours}`);
  }
  return -hours * 60;
}

function to24Hour(hour12: number, meridiem: string): number {
  const isPm = meridiem.toLowerCase() === "pm";
  const normalized = hour12 % 12; // 12am/12pm -> 0
  return isPm ? normalized + 12 : normalized;
}

/**
 * Computes the next upcoming occurrence of the reset time (as a UTC epoch) from text such as
 * "You've hit your session limit · resets 11pm (Etc/GMT-9)" (time only, session limit) or
 * "You've hit your weekly limit · resets Aug 1, 10pm (Etc/GMT-9)" (with month+day, weekly limit).
 *
 * - When a month+day is present (weekly limit): use that date as-is. Only treat it as next
 *   year if using the current year would place it far in the past (crossing a year boundary).
 * - When only a time is present (session limit): since there's no date, use "the next
 *   occurrence of that time at or after the reference time" (by design, the session (5-hour)
 *   limit is always guaranteed to fall within 24 hours).
 *
 * Returns null rather than throwing for an unrecognized format; the caller logs a warning.
 */
export function parseResetTimeText(text: string, referenceNow: Date = new Date()): Date | null {
  const match = text.match(RESET_TEXT_PATTERN);
  if (!match) {
    logger.warn(`Failed to parse the reset time text (possible format mismatch): "${text}"`);
    return null;
  }

  const [, monthName, dayStr, hourStr, minuteStr, meridiem, offsetStr] = match;
  const hour24 = to24Hour(Number.parseInt(hourStr, 10), meridiem);
  const minute = minuteStr ? Number.parseInt(minuteStr, 10) : 0;

  let offsetMinutes: number;
  try {
    offsetMinutes = parseEtcGmtOffsetMinutes(offsetStr);
  } catch (err) {
    logger.warn(`Failed to parse the timezone offset: "${text}" (${(err as Error).message})`);
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
      logger.warn(`Failed to parse the month name (possibly an unrecognized month name): "${text}"`);
      return null;
    }
    const day = Number.parseInt(dayStr, 10);

    let candidateShiftedMs = Date.UTC(y, monthIndex, day, hour24, minute, 0, 0);
    let candidateUtcMs = candidateShiftedMs - offsetMinutes * 60_000;

    // Year-boundary correction: e.g. building "Jan 2" detected in December using the same
    // year would land nearly a year in the past, so only assume next year if the drift into
    // the past is large enough, then rebuild.
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
