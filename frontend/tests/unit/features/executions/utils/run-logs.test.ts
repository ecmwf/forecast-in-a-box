/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type {
  LocatableFile,
  ParsedLog,
} from '@/features/executions/utils/run-logs'
import {
  countEntries,
  defaultLogFile,
  filterLines,
  firstIndexFrom,
  formatLogTime,
  indexOfLine,
  lastTime,
  lineLevel,
  lineText,
  lineTime,
  listArchive,
  locateFailure,
  logFileGroup,
  logFileLabel,
  parseLogText,
  readArchiveFile,
  runWindow,
  serverClockOffset,
  tailBytes,
} from '@/features/executions/utils/run-logs'

const JOB = 'job_3cb680a4-1bc8-4001-9dae-c0f0db7009e4'

const texts = (log: ParsedLog, indices: ArrayLike<number>) =>
  Array.from(indices, (i) => lineText(log, i))

describe('log file names', () => {
  it('groups run, server and detail files', () => {
    expect(logFileGroup(`${JOB}.controller.logs.txt`)).toBe('run')
    expect(logFileGroup(`${JOB}.host_0.worker_w0.stderr.txt`)).toBe('run')
    expect(logFileGroup('backend.logs.txt')).toBe('server')
    expect(logFileGroup('lens.65e780a2.stderr.txt')).toBe('server')
    expect(logFileGroup('gw_state.json')).toBe('details')
  })

  it('drops the run prefix and the log suffix', () => {
    expect(logFileLabel(`${JOB}.controller.logs.txt`)).toBe('controller')
    expect(logFileLabel(`${JOB}.host_0.worker_w0.stderr.txt`)).toBe(
      'host_0.worker_w0.stderr',
    )
    expect(logFileLabel('gateway.2026-11-07_16-58-35.logs.txt')).toBe(
      'gateway.2026-11-07_16-58-35',
    )
    expect(logFileLabel('db_entity.json')).toBe('db_entity.json')
  })
})

describe('listArchive', () => {
  it('lists non-empty entries, the run first, without inflating', () => {
    const zip = zipSync({
      'backend.logs.txt': strToU8('server line'),
      'gw_state.json': strToU8('{}'),
      'lens.1.stdout.txt': new Uint8Array(),
      [`${JOB}.host_0.executor.logs.txt`]: strToU8('executor'),
      [`${JOB}.controller.logs.txt`]: strToU8('controller'),
    })
    const { entries } = listArchive(zip)
    expect(entries.map((f) => [f.label, f.bytes])).toEqual([
      ['controller', 10],
      ['host_0.executor', 8],
      ['backend', 11],
      ['gw_state.json', 2],
    ])
    expect(
      new TextDecoder().decode(readArchiveFile(zip, 'gw_state.json')),
    ).toBe('{}')
  })

  it('leaves files over the declared-size limits packed', () => {
    const zip = zipSync({
      'backend.logs.txt': strToU8('x'.repeat(20)),
      'gateway.logs.txt': strToU8('y'.repeat(8)),
      'lens.1.stdout.txt': strToU8('z'.repeat(8)),
    })
    const { entries, skipped } = listArchive(zip, {
      fileBytes: 10,
      totalBytes: 12,
    })
    expect(entries.map((f) => f.label)).toEqual(['gateway'])
    expect(skipped.map((f) => [f.label, f.bytes])).toEqual([
      ['backend', 20],
      ['lens.1.stdout', 8],
    ])
  })
})

describe('tailBytes', () => {
  const bytes = strToU8('one\ntwo\nthree\nfour\n')

  it('keeps a file within the limit whole', () => {
    expect(tailBytes(bytes, 100)).toEqual({ bytes, cutLines: 0 })
  })

  it('starts the tail at a line and counts the lines cut', () => {
    const { bytes: tail, cutLines } = tailBytes(bytes, 12)
    expect(new TextDecoder().decode(tail)).toBe('three\nfour\n')
    expect(cutLines).toBe(2)
    // Exactly at a line start.
    expect(new TextDecoder().decode(tailBytes(bytes, 11).bytes)).toBe(
      'three\nfour\n',
    )
  })
})

describe('parseLogText', () => {
  const text = [
    '2026-11-07 13:17:30,197:DEBUG:cascade.bridge:27432:start',
    '2026-11-07 13:17:30,246:WARNING:cascade.bridge:27432:double registration',
    '2026-11-07 13:18:21,051:ERROR:cascade.runner:27461:command failed',
    'Traceback (most recent call last):',
    '  File "x.py", line 1, in <module>',
    '[2026-11-07 16:58:36 +0100] [7990] [INFO] Starting gunicorn',
    '',
  ].join('\n')
  const log = parseLogText(text)
  const all = Array.from({ length: 6 }, (_, i) => i)

  it('reads each entry level and carries it to continuation lines', () => {
    expect(all.map((i) => lineLevel(log, i))).toEqual([
      'debug',
      'warning',
      'error',
      'error',
      'error',
      'info',
    ])
    expect(lineText(log, 3)).toBe('Traceback (most recent call last):')
  })

  it('filters by a minimum level', () => {
    const filter = { query: '', window: null }
    expect(filterLines(log, { ...filter, minLevel: 'warning' })).toHaveLength(4)
    expect(filterLines(log, { ...filter, minLevel: null })).toHaveLength(6)
    expect(
      filterLines(parseLogText('plain'), { ...filter, minLevel: 'debug' }),
    ).toHaveLength(0)
  })

  it('finds lines by text, ignoring case, once per line', () => {
    const found = filterLines(log, {
      query: 'cascade',
      minLevel: null,
      window: null,
    })
    expect(Array.from(found)).toEqual([0, 1, 2])
    expect(
      texts(
        log,
        filterLines(log, { query: 'traceback', minLevel: null, window: null }),
      ),
    ).toEqual(['Traceback (most recent call last):'])
  })

  it('counts entries, not traceback lines', () => {
    expect(countEntries(log)).toEqual({ warning: 1, error: 1 })
  })

  it('numbers lines from the first line read', () => {
    const tail = parseLogText('a\nb\nc', 41)
    const indices = filterLines(tail, {
      query: '',
      minLevel: null,
      window: null,
    })
    expect(indexOfLine(tail, indices, 42)).toBe(1)
    expect(indexOfLine(tail, indices, 40)).toBe(-1)
    expect(firstIndexFrom(tail, indices, 42)).toBe(1)
    expect(firstIndexFrom(tail, indices, 99)).toBe(3)
  })
})

/** A parsed file as the store keeps it. */
function file(name: string, lines: Array<string>): LocatableFile {
  const log = parseLogText(lines.join('\n'))
  return {
    name,
    label: logFileLabel(name),
    group: logFileGroup(name),
    counts: countEntries(log),
    log,
  }
}

describe('defaultLogFile', () => {
  const warning = '2026-11-08 08:15:10,694:WARNING:multiurl.retry:1:503'
  const error = '2026-11-08 08:15:10,694:ERROR:cascade.runner:1:failed'

  it('prefers errors, then warnings, among the run files', () => {
    const controller = file(`${JOB}.controller.logs.txt`, ['start'])
    const w1 = file(`${JOB}.host_0.worker_w1.logs.txt`, [warning])
    const w0 = file(`${JOB}.host_0.worker_w0.logs.txt`, [error])
    const backend = file('backend.logs.txt', [error, error])
    expect(defaultLogFile([controller, w1, backend])).toBe(w1)
    expect(defaultLogFile([controller, w1, w0, backend])).toBe(w0)
    expect(defaultLogFile([controller, backend])).toBe(controller)
  })

  it('falls back to the first file without run files', () => {
    const backend = file('backend.logs.txt', [error])
    expect(defaultLogFile([backend])).toBe(backend)
    expect(defaultLogFile([])).toBeUndefined()
  })
})

describe('locateFailure', () => {
  const at = '2026-11-08 08:39:23,378'
  const w1 = file(`${JOB}.host_0.worker_w1.logs.txt`, [
    `${at}:ERROR:cascade.executor.runner.entrypoint:1:pkg install failed`,
    `${at}:INFO:cascade.executor.runner:1:retrying`,
    `${at}:ERROR:cascade.executor.runner.entrypoint:1:runner failure`,
    'Traceback (most recent call last):',
    'ValueError: matmul: dimension mismatch',
  ])
  const w0 = file(`${JOB}.host_0.worker_w0.logs.txt`, [
    `${at}:ERROR:a:1:x`,
    `${at}:ERROR:a:1:y`,
  ])
  const controller = file(`${JOB}.controller.logs.txt`, [
    `${at}:INFO:a:1:start`,
    `${at}:ERROR:cascade.controller.report:1:reporting a controller crash`,
  ])
  const files = [controller, w0, w1]

  it('points at the failing worker last error entry', () => {
    const message = "CascadeUserError('host=l0; worker=l0.w1; task=map_plot"
    expect(locateFailure(files, message)).toEqual({ file: w1.name, line: 3 })
  })

  it('falls back to the controller, then the file with the most errors', () => {
    expect(locateFailure(files, 'OOM killed')).toEqual({
      file: controller.name,
      line: 2,
    })
    expect(locateFailure([w0, w1], 'OOM killed')).toEqual({
      file: w0.name,
      line: 2,
    })
  })

  it('opens a file without a line when nothing has errors', () => {
    const quiet = file('backend.logs.txt', [`${at}:INFO:a:1:ok`])
    expect(locateFailure([quiet], 'x')).toEqual({ file: 'backend.logs.txt' })
    expect(locateFailure([], 'x')).toBeUndefined()
  })
})

describe('run time window', () => {
  // Server at UTC+7.
  const fetchedAt = Date.parse('2026-11-08T01:16:10Z')
  const log = parseLogText(
    [
      '2026-11-08 08:10:00,000:INFO:uvicorn.error:1:Started server process',
      '2026-11-08 08:14:41,000:ERROR:forecastbox:1:compile failed',
      'Traceback (most recent call last):',
      '2026-11-08 08:16:09,500:INFO:forecastbox.routes.run:1:will fetch logs',
    ].join('\n'),
  )
  const all = { query: '', minLevel: null }

  it('reads entry times and carries them to continuation lines', () => {
    expect(lineTime(log, 2)).toBe(lineTime(log, 1))
    expect(formatLogTime(lineTime(log, 1) ?? 0)).toBe('08:14:41')
  })

  it('finds the server clock offset from its newest line', () => {
    const server = { group: 'server' as const, lastTime: lastTime(log) }
    expect(serverClockOffset([server], fetchedAt)).toBe(7 * 3_600_000)
    expect(serverClockOffset([], fetchedAt)).toBeNull()
  })

  it('keeps the lines between the run start and end', () => {
    const offset = 7 * 3_600_000
    const ended = runWindow(
      '2026-11-08T01:14:40+00:00',
      '2026-11-08T01:15:00+00:00',
      offset,
    )
    expect(ended).not.toBeNull()
    if (!ended) return
    expect(Array.from(filterLines(log, { ...all, window: ended }))).toEqual([
      1, 2,
    ])
    const running = runWindow('2026-11-08T01:14:40+00:00', null, offset)
    if (!running) return
    expect(running.to).toBeNull()
    expect(filterLines(log, { ...all, window: running })).toHaveLength(3)
    expect(runWindow('not a date', null, offset)).toBeNull()
  })
})
