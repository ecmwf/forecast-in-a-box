/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Parsing for the `GET /run/logs` archive. */

import { unzipSync } from 'fflate'

/** `run`: this run's process logs; `server`: shared by all runs. */
export type LogFileGroup = 'run' | 'server' | 'details'

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

// job_<cascade job id>.<process>[.logs].txt
const RUN_FILE = /^job_[^.]+\.(.+?)(?:\.logs)?\.txt$/
const DETAIL_FILES = new Set([
  'db_entity.json',
  'gw_state.json',
  'logs_directory.error.txt',
])
const GROUP_ORDER: Record<LogFileGroup, number> = {
  run: 0,
  server: 1,
  details: 2,
}

/** The server's note when it couldn't collect the run's logs. */
export const COLLECT_ERROR_FILE = 'logs_directory.error.txt'

export function logFileGroup(name: string): LogFileGroup {
  if (RUN_FILE.test(name)) return 'run'
  if (DETAIL_FILES.has(name)) return 'details'
  return 'server'
}

/** Name without the run prefix and `.logs.txt`. */
export function logFileLabel(name: string): string {
  const run = RUN_FILE.exec(name)
  if (run) return run[1]
  return name.replace(/(?:\.logs)?\.txt$/, '')
}

export interface ArchiveEntry {
  /** Path inside the archive. */
  name: string
  label: string
  /** Unpacked size, as the zip declares it. */
  bytes: number
}

/** fflate allocates the size a zip header declares before inflating (CVE-2026-122146). */
export const ARCHIVE_LIMITS = {
  fileBytes: 100 * 2 ** 20,
  totalBytes: 400 * 2 ** 20,
}

/** What is read for viewing; the rest stays in the download. */
export const VIEW_LIMITS = {
  /** A larger file is read from its last this many bytes. */
  fileBytes: 20 * 2 ** 20,
  /** Files past this total are not read. */
  totalBytes: 60 * 2 ** 20,
}

/** Non-empty entries, this run's first, each group by label; nothing is inflated. */
export function listArchive(
  data: Uint8Array,
  limits = ARCHIVE_LIMITS,
): { entries: Array<ArchiveEntry>; skipped: Array<ArchiveEntry> } {
  const entries: Array<ArchiveEntry> = []
  const skipped: Array<ArchiveEntry> = []
  let total = 0
  unzipSync(data, {
    filter: ({ name, originalSize }) => {
      if (name.endsWith('/') || originalSize === 0) return false
      const entry = { name, label: logFileLabel(name), bytes: originalSize }
      const fits =
        originalSize <= limits.fileBytes &&
        total + originalSize <= limits.totalBytes
      if (fits) {
        total += originalSize
        entries.push(entry)
      } else skipped.push(entry)
      return false
    },
  })
  entries.sort(
    (a, b) =>
      GROUP_ORDER[logFileGroup(a.name)] - GROUP_ORDER[logFileGroup(b.name)] ||
      a.label.localeCompare(b.label),
  )
  return { entries, skipped }
}

/** One entry, inflated on its own. */
export function readArchiveFile(data: Uint8Array, name: string): Uint8Array {
  const files = unzipSync(data, { filter: (file) => file.name === name })
  return files[name] ?? new Uint8Array()
}

const NEWLINE = 0x0a

/** The last `limit` bytes from a line start, and how many lines come before them. */
export function tailBytes(
  bytes: Uint8Array,
  limit: number,
): { bytes: Uint8Array; cutLines: number } {
  if (bytes.length <= limit) return { bytes, cutLines: 0 }
  const newline = bytes.indexOf(NEWLINE, bytes.length - limit - 1)
  const start = newline === -1 ? bytes.length : newline + 1
  let cutLines = 0
  for (let i = 0; i < start; i++) if (bytes[i] === NEWLINE) cutLines++
  return { bytes: bytes.subarray(start), cutLines }
}

/** Level codes in `ParsedLog.levels`; 0 is none. */
const LEVEL_BY_CODE: ReadonlyArray<LogLevel | null> = [
  null,
  'debug',
  'info',
  'warning',
  'error',
]
const LEVEL_CODE: Record<LogLevel, number> = {
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
}
const LEVELS: Record<string, LogLevel> = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warning',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'error',
  FATAL: 'error',
}
const LEVEL_NAMES = 'DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL'
// Sticky: matched at a line start inside the whole text.
const LEVEL_PATTERNS = [
  // Python logging as configured here: `2026-11-07 13:17:30,246:WARNING:...`
  new RegExp(`\\d{4}-\\d\\d-\\d\\d[ T][\\d:,.]+:(${LEVEL_NAMES}):`, 'y'),
  // gunicorn: `[2026-11-07 16:58:36 +0100] [7990] [INFO] ...`
  new RegExp(`\\[[^\\]\\n]*\\] \\[\\d+\\] \\[(${LEVEL_NAMES})\\]`, 'y'),
  // Python's default format: `ERROR:root:...`
  new RegExp(`(${LEVEL_NAMES}):`, 'y'),
]
// Python `2026-11-07 13:17:30,246` or gunicorn `[2026-11-07 16:58:36`.
const TIME_PATTERN =
  /\[?(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:[,.](\d{1,3}))?/y

function levelAt(text: string, at: number): LogLevel | undefined {
  for (const pattern of LEVEL_PATTERNS) {
    pattern.lastIndex = at
    const match = pattern.exec(text)
    if (match) return LEVELS[match[1]]
  }
  return undefined
}

function timeAt(text: string, at: number): number | undefined {
  TIME_PATTERN.lastIndex = at
  const m = TIME_PATTERN.exec(text)
  if (!m) return undefined
  const [, y, mo, d, h, mi, sec, ms = '0'] = m
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, +ms.padEnd(3, '0'))
}

/** A log text with one entry per line in typed arrays. */
export interface ParsedLog {
  /** Without a final newline. */
  text: string
  /** Offset of each line in `text`. */
  starts: Uint32Array
  /** Level code of each line's entry; continuation lines inherit it. */
  levels: Uint8Array
  /** 1 where a line starts an entry. */
  entries: Uint8Array
  /** Entry time, server wall clock as UTC ms, NaN without; inherited. */
  times: Float64Array
  /** File line number of the first line. */
  firstNumber: number
}

export function parseLogText(text: string, firstNumber = 1): ParsedLog {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  let count = 1
  for (let i = 0; i < body.length; i++) if (body.charCodeAt(i) === 10) count++
  const starts = new Uint32Array(count)
  const levels = new Uint8Array(count)
  const entries = new Uint8Array(count)
  const times = new Float64Array(count)
  let start = 0
  let level = 0
  let time = Number.NaN
  for (let i = 0; i < count; i++) {
    starts[i] = start
    const own = levelAt(body, start)
    if (own) {
      level = LEVEL_CODE[own]
      entries[i] = 1
    }
    time = timeAt(body, start) ?? time
    levels[i] = level
    times[i] = time
    const end = body.indexOf('\n', start)
    start = end === -1 ? body.length : end + 1
  }
  return { text: body, starts, levels, entries, times, firstNumber }
}

export function lineCount(log: ParsedLog): number {
  return log.starts.length
}

/** Line `index`, without its newline. */
export function lineText(
  log: Pick<ParsedLog, 'text' | 'starts'>,
  index: number,
): string {
  const end =
    index + 1 < log.starts.length ? log.starts[index + 1] - 1 : log.text.length
  const line = log.text.slice(log.starts[index], end)
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

export function lineLevel(
  log: Pick<ParsedLog, 'levels'>,
  index: number,
): LogLevel | null {
  return LEVEL_BY_CODE[log.levels[index]] ?? null
}

/** Entry time of line `index`, or null. */
export function lineTime(log: ParsedLog, index: number): number | null {
  const time = log.times[index]
  return Number.isNaN(time) ? null : time
}

export interface EntryCounts {
  warning: number
  error: number
}

/** Warning and error entries, not lines; over `indices` when given. */
export function countEntries(
  log: ParsedLog,
  indices?: ArrayLike<number>,
): EntryCounts {
  const counts = { warning: 0, error: 0 }
  const n = indices ? indices.length : lineCount(log)
  for (let k = 0; k < n; k++) {
    const i = indices ? indices[k] : k
    if (!log.entries[i]) continue
    if (log.levels[i] === LEVEL_CODE.warning) counts.warning++
    else if (log.levels[i] === LEVEL_CODE.error) counts.error++
  }
  return counts
}

/** Newest entry time, or null. */
export function lastTime(log: ParsedLog): number | null {
  for (let i = lineCount(log) - 1; i >= 0; i--) {
    if (!Number.isNaN(log.times[i])) return log.times[i]
  }
  return null
}

/** Run file with the most errors, then warnings; else the first file. */
export function defaultLogFile<
  T extends { group: LogFileGroup; counts: EntryCounts },
>(files: ReadonlyArray<T>): T | undefined {
  const run = files.filter((f) => f.group === 'run')
  if (run.length === 0) return files.at(0)
  return [...run].sort(
    (a, b) =>
      b.counts.error - a.counts.error || b.counts.warning - a.counts.warning,
  )[0]
}

const QUARTER_HOUR_MS = 15 * 60 * 1000

/** Server clock's UTC offset in ms, from its newest line. */
export function serverClockOffset(
  files: ReadonlyArray<{ group: LogFileGroup; lastTime: number | null }>,
  fetchedAt: number,
): number | null {
  let newest: number | null = null
  for (const f of files) {
    if (f.group !== 'server' || f.lastTime === null) continue
    if (newest === null || f.lastTime > newest) newest = f.lastTime
  }
  if (newest === null) return null
  return Math.round((newest - fetchedAt) / QUARTER_HOUR_MS) * QUARTER_HOUR_MS
}

/** A run's bounds in `ParsedLog.times` units. */
export interface RunWindow {
  from: number
  /** `null` while the run goes on. */
  to: number | null
}

const WINDOW_LEAD_MS = 5_000
const WINDOW_TAIL_MS = 10_000

export function runWindow(
  startedAt: string,
  endedAt: string | null,
  offset: number,
): RunWindow | null {
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return null
  const end = endedAt === null ? Number.NaN : Date.parse(endedAt)
  return {
    from: start + offset - WINDOW_LEAD_MS,
    to: Number.isNaN(end) ? null : end + offset + WINDOW_TAIL_MS,
  }
}

/** Keeps lines without a time. */
function inWindow(time: number, window: RunWindow): boolean {
  if (Number.isNaN(time)) return true
  return time >= window.from && (window.to === null || time <= window.to)
}

/** `HH:MM:SS` of an entry time. */
export function formatLogTime(time: number): string {
  return new Date(time).toISOString().slice(11, 19)
}

export interface LineFilter {
  /** Lower case; empty keeps every line. */
  query: string
  /** `null` keeps every level. */
  minLevel: LogLevel | null
  /** `null` keeps every time. */
  window: RunWindow | null
}

const lowerTexts = new WeakMap<ParsedLog, string | null>()

/** The text in lower case, or null when that changes its length. */
function lowerText(log: ParsedLog): string | null {
  let lower = lowerTexts.get(log)
  if (lower === undefined) {
    lower = log.text.toLowerCase()
    if (lower.length !== log.text.length) lower = null
    lowerTexts.set(log, lower)
  }
  return lower
}

/** Index of the line holding text offset `at`. */
function lineAt(log: ParsedLog, at: number): number {
  let lo = 0
  let hi = log.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (log.starts[mid] <= at) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Lines containing `query`, in order. */
function queryLines(log: ParsedLog, query: string): Array<number> {
  const found: Array<number> = []
  const lower = lowerText(log)
  if (lower === null) {
    for (let i = 0; i < lineCount(log); i++) {
      if (lineText(log, i).toLowerCase().includes(query)) found.push(i)
    }
    return found
  }
  let at = lower.indexOf(query)
  while (at !== -1) {
    const line = lineAt(log, at)
    found.push(line)
    const next = line + 1 < lineCount(log) ? log.starts[line + 1] : lower.length
    at = lower.indexOf(query, next)
  }
  return found
}

/** Indices of the lines the filter keeps. */
export function filterLines(log: ParsedLog, filter: LineFilter): Uint32Array {
  const min = filter.minLevel === null ? 0 : LEVEL_CODE[filter.minLevel]
  const keep = (i: number) =>
    log.levels[i] >= min &&
    (filter.window === null || inWindow(log.times[i], filter.window))
  if (filter.query) {
    return Uint32Array.from(queryLines(log, filter.query).filter(keep))
  }
  if (min === 0 && filter.window === null) {
    return Uint32Array.from({ length: lineCount(log) }, (_, i) => i)
  }
  const kept: Array<number> = []
  for (let i = 0; i < lineCount(log); i++) if (keep(i)) kept.push(i)
  return Uint32Array.from(kept)
}

/** Index of `line` (a file line number) in `indices`, or -1. */
export function indexOfLine(
  log: Pick<ParsedLog, 'firstNumber'>,
  indices: Uint32Array,
  line: number,
): number {
  const target = line - log.firstNumber
  let lo = 0
  let hi = indices.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (indices[mid] === target) return mid
    if (indices[mid] < target) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/** Position of the first index at or after line `line`, or `indices.length`. */
export function firstIndexFrom(
  log: Pick<ParsedLog, 'firstNumber'>,
  indices: Uint32Array,
  line: number,
): number {
  const target = line - log.firstNumber
  let lo = 0
  let hi = indices.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (indices[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface LogLocation {
  /** Archive path. */
  file: string
  /** Absent when the file has no error. */
  line?: number
}

// `host=l0; worker=l0.w1` in a task failure.
const FAILED_WORKER = /\bhost=l(\d+); worker=l\d+\.(w\d+)\b/

function lastErrorEntry(log: ParsedLog): number | undefined {
  for (let i = lineCount(log) - 1; i >= 0; i--) {
    if (log.entries[i] && log.levels[i] === LEVEL_CODE.error) {
      return log.firstNumber + i
    }
  }
  return undefined
}

export interface LocatableFile {
  name: string
  label: string
  group: LogFileGroup
  counts: EntryCounts
  log: ParsedLog
}

/** Last error of the failing worker, else controller, else most errors. */
export function locateFailure(
  files: ReadonlyArray<LocatableFile>,
  message: string,
): LogLocation | undefined {
  const runFile = (label: string) =>
    files.find((f) => f.group === 'run' && f.label === label)
  const worker = FAILED_WORKER.exec(message)
  const candidates = [
    worker ? runFile(`host_${worker[1]}.worker_${worker[2]}`) : undefined,
    runFile('controller'),
    defaultLogFile(files),
  ].filter((f): f is LocatableFile => f !== undefined)
  for (const file of candidates) {
    const line = lastErrorEntry(file.log)
    if (line !== undefined) return { file: file.name, line }
  }
  const first = candidates.at(0)
  return first && { file: first.name }
}
