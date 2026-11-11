/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** One run log archive, read within budgets; runs in the log worker. */

import { strFromU8 } from 'fflate'
import {
  ARCHIVE_LIMITS,
  COLLECT_ERROR_FILE,
  VIEW_LIMITS,
  countEntries,
  filterLines,
  lastTime,
  lineCount,
  lineLevel,
  lineText,
  listArchive,
  locateFailure,
  logFileGroup,
  parseLogText,
  readArchiveFile,
  tailBytes,
} from './run-logs'
import type {
  ArchiveEntry,
  EntryCounts,
  LineFilter,
  LogFileGroup,
  LogLevel,
  LogLocation,
  ParsedLog,
} from './run-logs'

export interface LogFileMeta {
  /** Path inside the archive. */
  name: string
  label: string
  group: LogFileGroup
  /** Unpacked size of the whole file. */
  bytes: number
  /** Bytes read: the whole file, or its tail. */
  readBytes: number
  /** Lines in the whole file. */
  totalLines: number
  /** File line number of the first line read. */
  firstNumber: number
  counts: EntryCounts
  /** Newest entry time, server clock. */
  lastTime: number | null
}

export interface LogSnapshotSummary {
  files: Array<LogFileMeta>
  /** Over the archive limits; left packed. */
  skipped: Array<ArchiveEntry>
  /** Past the view budget; only in the download. */
  unread: Array<ArchiveEntry>
  /** The server's note when it couldn't collect the run's logs. */
  collectError: string | null
}

export interface ViewRequest extends LineFilter {
  /** A file, or null for every log file. */
  file: string | null
  /** Also returns the file's lines. */
  content: boolean
  /** Rows per file when `file` is null. */
  sectionLimit: number
}

export interface FileView {
  /** Lines within the window. */
  scoped: number
  /** Within the window. */
  counts: EntryCounts
  matches: number
}

export interface LogRow {
  number: number
  text: string
  level: LogLevel | null
}

export interface LogSection {
  name: string
  matches: number
  /** The last matches. */
  rows: Array<LogRow>
}

/** A file's lines for the viewer. */
export type FileContent = Pick<
  ParsedLog,
  'text' | 'starts' | 'levels' | 'firstNumber'
>

export interface ViewResult {
  perFile: Record<string, FileView>
  /** One file: indices of its matching lines. */
  indices?: Uint32Array
  /** Every file: the last matches of each. */
  sections?: Array<LogSection>
  /** First error among the matches. */
  firstError?: LogLocation
  content?: FileContent
}

interface StoredFile {
  meta: LogFileMeta
  log: ParsedLog
}

export class LogSnapshotStore {
  private zip: Uint8Array = new Uint8Array()
  private files: Array<StoredFile> = []

  load(
    zip: Uint8Array,
    view = VIEW_LIMITS,
    archive = ARCHIVE_LIMITS,
  ): LogSnapshotSummary {
    this.zip = zip
    this.files = []
    const { entries, skipped } = listArchive(zip, archive)
    const unread: Array<ArchiveEntry> = []
    let budget = view.totalBytes
    for (const entry of entries) {
      const take = Math.min(entry.bytes, view.fileBytes)
      if (take > budget) {
        unread.push(entry)
        continue
      }
      const { bytes, cutLines } = tailBytes(
        readArchiveFile(zip, entry.name),
        view.fileBytes,
      )
      budget -= bytes.length
      const log = parseLogText(strFromU8(bytes), cutLines + 1)
      const counts = countEntries(log)
      this.files.push({
        log,
        meta: {
          name: entry.name,
          label: entry.label,
          group: logFileGroup(entry.name),
          bytes: entry.bytes,
          readBytes: bytes.length,
          totalLines: cutLines + lineCount(log),
          firstNumber: log.firstNumber,
          counts,
          lastTime: lastTime(log),
        },
      })
    }
    const collect = this.files.find((f) => f.meta.name === COLLECT_ERROR_FILE)
    return {
      files: this.files.map((f) => f.meta),
      skipped,
      unread,
      collectError: collect ? collect.log.text : null,
    }
  }

  view(request: ViewRequest): ViewResult {
    const perFile: Record<string, FileView> = {}
    const matchesOf = new Map<string, Uint32Array>()
    for (const { meta, log } of this.files) {
      // The run window applies to the server-wide files only.
      const window = meta.group === 'server' ? request.window : null
      const scoped = window ? filterLines(log, { ...ALL, window }) : null
      const matches = filterLines(log, { ...request, window })
      matchesOf.set(meta.name, matches)
      perFile[meta.name] = {
        scoped: scoped ? scoped.length : lineCount(log),
        counts: scoped ? countEntries(log, scoped) : meta.counts,
        matches: matches.length,
      }
    }

    if (request.file !== null) {
      const file = this.find(request.file)
      const indices = matchesOf.get(request.file) ?? new Uint32Array()
      const result: ViewResult = { perFile, indices }
      if (file) {
        const error = firstError(file.log, indices)
        if (error !== undefined) {
          result.firstError = { file: file.meta.name, line: error }
        }
        if (request.content) result.content = contentOf(file.log)
      }
      return result
    }

    const sections: Array<LogSection> = []
    let first: LogLocation | undefined
    for (const { meta, log } of this.files) {
      if (meta.group === 'details') continue
      const indices = matchesOf.get(meta.name) ?? new Uint32Array()
      if (indices.length === 0) continue
      const shown = indices.subarray(
        Math.max(0, indices.length - request.sectionLimit),
      )
      sections.push({
        name: meta.name,
        matches: indices.length,
        rows: Array.from(shown, (i) => ({
          number: log.firstNumber + i,
          text: lineText(log, i),
          level: lineLevel(log, i),
        })),
      })
      if (!first) {
        const error = firstError(log, indices)
        if (error !== undefined) first = { file: meta.name, line: error }
      }
    }
    return { perFile, sections, firstError: first }
  }

  /** The whole file, inflated again from the archive. */
  fileBytes(name: string): Uint8Array {
    return readArchiveFile(this.zip, name)
  }

  locate(message: string): LogLocation | undefined {
    return locateFailure(
      this.files.map(({ meta, log }) => ({ ...meta, log })),
      message,
    )
  }

  private find(name: string): StoredFile | undefined {
    return this.files.find((f) => f.meta.name === name)
  }
}

const ALL: LineFilter = { query: '', minLevel: null, window: null }

/** File line number of the first error entry among `indices`. */
function firstError(log: ParsedLog, indices: Uint32Array): number | undefined {
  for (const i of indices) {
    if (lineLevel(log, i) === 'error') return log.firstNumber + i
  }
  return undefined
}

/** Copies, so the worker keeps its own. */
function contentOf(log: ParsedLog): FileContent {
  return {
    text: log.text,
    starts: log.starts.slice(),
    levels: log.levels.slice(),
    firstNumber: log.firstNumber,
  }
}
