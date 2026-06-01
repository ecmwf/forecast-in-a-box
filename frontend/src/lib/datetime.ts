/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Timezone utilities — the single source of truth for application-timezone
 * handling.
 *
 * Canonical rule: forecast date/times are stored and transmitted as naive UTC
 * (`YYYY-MM-DDTHH:MM:SS`); the application timezone is a presentation layer.
 * Conversion happens only at the entry/display boundary via `convertNaive`.
 *
 * Two accessors expose the app timezone:
 *  - `useAppTimeZone()` — reactive hook, for React components.
 *  - `getAppTimeZone()` — imperative snapshot, for plain modules that cannot
 *    call hooks (e.g. value-type-parser, job-name).
 */

import { TZDate, tzOffset } from '@date-fns/tz'
import { format } from 'date-fns'
import { useUiStore } from '@/stores/uiStore'

const DEFAULT_TIME_ZONE = 'UTC'

/** A naive ISO date-time (`YYYY-MM-DDTHH:MM[:SS]`); the time part is required. */
const NAIVE_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/

// ── App timezone accessors ───────────────────────────────────────────────

/**
 * Validity cache — keyed by zone string, bounded by the IANA zone set.
 * Pre-seeded with the default zone so the common case taken by
 * `useAppTimeZone`'s selector never constructs an `Intl.DateTimeFormat`.
 */
const timeZoneValidity = new Map<string, boolean>([['UTC', true]])

/**
 * True if `tz` is an IANA identifier the runtime accepts. Cached per zone:
 * `useAppTimeZone`'s selector calls this on every store change.
 */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false
  const cached = timeZoneValidity.get(tz)
  if (cached !== undefined) return cached
  let valid: boolean
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    valid = true
  } catch {
    valid = false
  }
  timeZoneValidity.set(tz, valid)
  return valid
}

/** Current app timezone, read imperatively — for non-component modules. */
export function getAppTimeZone(): string {
  const tz = useUiStore.getState().timeZone
  return isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE
}

/** Current app timezone, reactive — re-renders the component when it changes. */
export function useAppTimeZone(): string {
  return useUiStore((s) =>
    isValidTimeZone(s.timeZone) ? s.timeZone : DEFAULT_TIME_ZONE,
  )
}

// ── Conversion: naive wall-clock <-> absolute instant ────────────────────

/**
 * Interpret a naive `YYYY-MM-DDTHH:MM[:SS]` string as wall-clock time in
 * `timeZone` and return the absolute instant (DST-correct). Returns an invalid
 * Date if the input is not a naive date-time.
 */
export function zonedNaiveToInstant(naive: string, timeZone: string): Date {
  const m = NAIVE_DATETIME_RE.exec(naive)
  if (!m) return new Date(NaN)
  const zoned = new TZDate(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] ? Number(m[6]) : 0,
    timeZone,
  )
  return new Date(zoned.getTime())
}

/** Render an absolute instant as a naive `YYYY-MM-DDTHH:MM:SS` in `timeZone`. */
export function instantToZonedNaive(instant: Date, timeZone: string): string {
  return formatInZone(instant, timeZone, "yyyy-MM-dd'T'HH:mm:ss")
}

/**
 * Re-express a naive wall-clock string from `fromTimeZone` into `toTimeZone`.
 * Identity when the zones match; passes non-date-time input through unchanged
 * (empty strings, `${glyph}` expressions).
 */
export function convertNaive(
  naive: string,
  fromTimeZone: string,
  toTimeZone: string,
): string {
  if (!naive || fromTimeZone === toTimeZone) return naive
  const instant = zonedNaiveToInstant(naive, fromTimeZone)
  if (Number.isNaN(instant.getTime())) return naive
  return instantToZonedNaive(instant, toTimeZone)
}

// ── "Now" / "today" in a zone ────────────────────────────────────────────

export interface ZonedParts {
  year: number
  /** 1-12. */
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Wall-clock parts of `instant` as observed in `timeZone`. */
export function nowPartsInZone(
  timeZone: string,
  instant: Date = new Date(),
): ZonedParts {
  const z = new TZDate(instant.getTime(), timeZone)
  return {
    year: z.getFullYear(),
    month: z.getMonth() + 1,
    day: z.getDate(),
    hour: z.getHours(),
    minute: z.getMinutes(),
    second: z.getSeconds(),
  }
}

/** Calendar date (`YYYY-MM-DD`) of `instant` in `timeZone`. */
export function todayInZone(
  timeZone: string,
  instant: Date = new Date(),
): string {
  return formatInZone(instant, timeZone, 'yyyy-MM-dd')
}

/** Calendar date (`YYYY-MM-DD`) of the day before `instant` in `timeZone`. */
export function yesterdayInZone(
  timeZone: string,
  instant: Date = new Date(),
): string {
  return todayInZone(timeZone, new Date(instant.getTime() - 86_400_000))
}

// ── Formatting ───────────────────────────────────────────────────────────

/**
 * Format an absolute instant (Date, epoch ms, or absolute ISO string) with a
 * date-fns pattern, rendered in `timeZone`. Returns '' for an invalid input.
 */
export function formatInZone(
  input: Date | number | string,
  timeZone: string,
  pattern: string,
): string {
  const instant = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(instant.getTime())) return ''
  return format(new TZDate(instant.getTime(), timeZone), pattern)
}

// ── Labels ───────────────────────────────────────────────────────────────

/**
 * Compact UTC-offset label for `timeZone` at `instant`:
 * 'UTC', 'UTC+2', 'UTC-4', 'UTC+5:30'.
 */
export function timeZoneOffsetLabel(
  timeZone: string,
  instant: Date = new Date(),
): string {
  const minutes = tzOffset(timeZone, instant)
  if (!minutes) return 'UTC'
  const sign = minutes > 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m === 0
    ? `UTC${sign}${h}`
    : `UTC${sign}${h}:${String(m).padStart(2, '0')}`
}

/**
 * Short timezone name for `timeZone` at `instant` ('UTC', 'EDT', 'GMT+2').
 * Falls back to the IANA identifier.
 */
export function timeZoneAbbreviation(
  timeZone: string,
  instant: Date = new Date(),
): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(instant)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone
  } catch {
    return timeZone
  }
}

/** Used only when `Intl.supportedValuesOf` is unavailable (very old runtimes). */
const FALLBACK_TIME_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
]

/**
 * IANA timezone identifiers for the picker. `Intl.supportedValuesOf` omits the
 * bare 'UTC', so it is prepended explicitly.
 */
export function listTimeZones(): Array<string> {
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: 'timeZone') => Array<string>
  }
  const zones =
    typeof intl.supportedValuesOf === 'function'
      ? intl.supportedValuesOf('timeZone')
      : FALLBACK_TIME_ZONES
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}
