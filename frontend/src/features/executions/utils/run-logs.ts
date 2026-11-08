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

import { strFromU8, unzipSync } from 'fflate'

/** `run`: this run's process logs; `server`: shared by all runs. */
export type LogFileGroup = 'run' | 'server' | 'details'

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export interface LogFile {
  /** Path inside the archive. */
  name: string
  label: string
  group: LogFileGroup
  bytes: Uint8Array
}

export interface LogLine {
  /** 1-based line number in the file. */
  number: number
  text: string
  /** Entry level; continuation lines inherit it. */
  level: LogLevel | null
  /** Entry time, server wall clock as UTC ms; inherited too. */
  time: number | null
}

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

/** Non-empty files, this run's first, each group by label. */
export function unpackLogArchive(data: Uint8Array): Array<LogFile> {
  return Object.entries(unzipSync(data))
    .filter(([name, bytes]) => !name.endsWith('/') && bytes.length > 0)
    .map(([name, bytes]) => ({
      name,
      label: logFileLabel(name),
      group: logFileGroup(name),
      bytes,
    }))
    .sort(
      (a, b) =>
        GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
        a.label.localeCompare(b.label),
    )
}

export function decodeLogFile(file: LogFile): string {
  return strFromU8(file.bytes)
}

export interface ParsedLogFile {
  file: LogFile
  text: string
  lines: Array<LogLine>
  counts: { warning: number; error: number }
}

export function parseLogFile(file: LogFile): ParsedLogFile {
  const text = decodeLogFile(file)
  const lines = parseLogLines(text)
  return { file, text, lines, counts: countEntries(lines) }
}

/** Run file with the most errors, then warnings; else the first file. */
export function defaultLogFile(
  files: ReadonlyArray<ParsedLogFile>,
): ParsedLogFile | undefined {
  const run = files.filter((f) => f.file.group === 'run')
  if (run.length === 0) return files.at(0)
  return [...run].sort(
    (a, b) =>
      b.counts.error - a.counts.error || b.counts.warning - a.counts.warning,
  )[0]
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
const LEVEL_PATTERNS = [
  // Python logging as configured here: `2026-11-07 13:17:30,246:WARNING:...`
  new RegExp(`^\\d{4}-\\d\\d-\\d\\d[ T][\\d:,.]+:(${LEVEL_NAMES}):`),
  // gunicorn: `[2026-11-07 16:58:36 +0100] [7990] [INFO] ...`
  new RegExp(`^\\[[^\\]]*\\] \\[\\d+\\] \\[(${LEVEL_NAMES})\\]`),
  // Python's default format: `ERROR:root:...`
  new RegExp(`^(${LEVEL_NAMES}):`),
]

function lineLevel(text: string): LogLevel | undefined {
  for (const pattern of LEVEL_PATTERNS) {
    const match = pattern.exec(text)
    if (match) return LEVELS[match[1]]
  }
  return undefined
}

// Python `2026-11-07 13:17:30,246` or gunicorn `[2026-11-07 16:58:36`.
const TIME_PATTERN =
  /^\[?(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:[,.](\d{1,3}))?/

function lineTime(text: string): number | undefined {
  const m = TIME_PATTERN.exec(text)
  if (!m) return undefined
  const [, y, mo, d, h, mi, sec, ms = '0'] = m
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, +ms.padEnd(3, '0'))
}

export function parseLogLines(text: string): Array<LogLine> {
  const lines = text.replace(/\n$/, '').split('\n')
  let level: LogLevel | null = null
  let time: number | null = null
  return lines.map((line, index) => {
    level = lineLevel(line) ?? level
    time = lineTime(line) ?? time
    return { number: index + 1, text: line, level, time }
  })
}

const QUARTER_HOUR_MS = 15 * 60 * 1000

/** Server clock's UTC offset in ms, from its newest line. */
export function serverClockOffset(
  files: ReadonlyArray<ParsedLogFile>,
  fetchedAt: number,
): number | null {
  let newest: number | null = null
  for (const f of files) {
    if (f.file.group !== 'server') continue
    const last = f.lines.at(-1)?.time ?? null
    if (last !== null && (newest === null || last > newest)) newest = last
  }
  if (newest === null) return null
  return Math.round((newest - fetchedAt) / QUARTER_HOUR_MS) * QUARTER_HOUR_MS
}

/** A run's bounds in `LogLine.time` units. */
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
export function inWindow(line: LogLine, window: RunWindow): boolean {
  if (line.time === null) return true
  return (
    line.time >= window.from && (window.to === null || line.time <= window.to)
  )
}

/** `HH:MM:SS` of a `LogLine.time`. */
export function formatLogTime(time: number): string {
  return new Date(time).toISOString().slice(11, 19)
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
}

/** `null` keeps every line. */
export function meetsLevel(line: LogLine, min: LogLevel | null): boolean {
  if (min === null) return true
  return line.level !== null && LEVEL_RANK[line.level] >= LEVEL_RANK[min]
}

/** Warning and error entries, not lines. */
export function countEntries(lines: ReadonlyArray<LogLine>): {
  warning: number
  error: number
} {
  const counts = { warning: 0, error: 0 }
  for (const line of lines) {
    const entryStart = lineLevel(line.text) !== undefined
    if (!entryStart) continue
    if (line.level === 'warning') counts.warning++
    if (line.level === 'error') counts.error++
  }
  return counts
}

export interface LogLocation {
  /** Archive path. */
  file: string
  /** Absent when the file has no error. */
  line?: number
}

// `host=l0; worker=l0.w1` in a task failure.
const FAILED_WORKER = /\bhost=l(\d+); worker=l\d+\.(w\d+)\b/

function lastErrorEntry(file: ParsedLogFile): LogLine | undefined {
  for (let i = file.lines.length - 1; i >= 0; i--) {
    const line = file.lines[i]
    if (line.level === 'error' && lineLevel(line.text) !== undefined) {
      return line
    }
  }
  return undefined
}

/** Last error of the failing worker, else controller, else most errors. */
export function locateFailure(
  files: ReadonlyArray<ParsedLogFile>,
  message: string,
): LogLocation | undefined {
  const runFile = (label: string) =>
    files.find((f) => f.file.group === 'run' && f.file.label === label)
  const worker = FAILED_WORKER.exec(message)
  const candidates = [
    worker ? runFile(`host_${worker[1]}.worker_${worker[2]}`) : undefined,
    runFile('controller'),
    defaultLogFile(files),
  ].filter((f): f is ParsedLogFile => f !== undefined)
  for (const file of candidates) {
    const line = lastErrorEntry(file)
    if (line) return { file: file.file.name, line: line.number }
  }
  const first = candidates.at(0)
  return first && { file: first.file.name }
}
