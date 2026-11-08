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
import type { LogFile } from '@/features/executions/utils/run-logs'
import {
  countEntries,
  defaultLogFile,
  formatLogTime,
  inWindow,
  locateFailure,
  logFileGroup,
  logFileLabel,
  meetsLevel,
  parseLogFile,
  parseLogLines,
  runWindow,
  serverClockOffset,
  unpackLogArchive,
} from '@/features/executions/utils/run-logs'

const JOB = 'job_3cb680a4-1bc8-4001-9dae-c0f0db7009e4'

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

describe('unpackLogArchive', () => {
  it('lists non-empty files, the run first', () => {
    const zip = zipSync({
      'backend.logs.txt': strToU8('server line'),
      'gw_state.json': strToU8('{}'),
      'lens.1.stdout.txt': new Uint8Array(),
      [`${JOB}.host_0.executor.logs.txt`]: strToU8('executor'),
      [`${JOB}.controller.logs.txt`]: strToU8('controller'),
    })
    expect(unpackLogArchive(zip).map((f) => f.label)).toEqual([
      'controller',
      'host_0.executor',
      'backend',
      'gw_state.json',
    ])
  })
})

describe('parseLogLines', () => {
  const text = [
    '2026-11-07 13:17:30,197:DEBUG:cascade.bridge:27432:start',
    '2026-11-07 13:17:30,246:WARNING:cascade.bridge:27432:double registration',
    '2026-11-07 13:18:21,051:ERROR:cascade.runner:27461:command failed',
    'Traceback (most recent call last):',
    '  File "x.py", line 1, in <module>',
    '[2026-11-07 16:58:36 +0100] [7990] [INFO] Starting gunicorn',
    '',
  ].join('\n')
  const lines = parseLogLines(text)

  it('reads each entry level and carries it to continuation lines', () => {
    expect(lines.map((l) => l.level)).toEqual([
      'debug',
      'warning',
      'error',
      'error',
      'error',
      'info',
    ])
    expect(lines[3].number).toBe(4)
  })

  it('filters by a minimum level', () => {
    expect(lines.filter((l) => meetsLevel(l, 'warning'))).toHaveLength(4)
    expect(lines.filter((l) => meetsLevel(l, null))).toHaveLength(6)
    expect(
      meetsLevel({ number: 1, text: 'x', level: null, time: null }, 'debug'),
    ).toBe(false)
  })

  it('counts entries, not traceback lines', () => {
    expect(countEntries(lines)).toEqual({ warning: 1, error: 1 })
  })
})

describe('defaultLogFile', () => {
  const file = (name: string, text: string) =>
    parseLogFile({
      name,
      label: name,
      group: logFileGroup(name),
      bytes: strToU8(text),
    } satisfies LogFile)
  const warning = '2026-11-08 08:15:10,694:WARNING:multiurl.retry:1:503'
  const error = '2026-11-08 08:15:10,694:ERROR:cascade.runner:1:failed'

  it('prefers errors, then warnings, among the run files', () => {
    const controller = file(`${JOB}.controller.logs.txt`, 'start')
    const w1 = file(`${JOB}.host_0.worker_w1.logs.txt`, warning)
    const w0 = file(`${JOB}.host_0.worker_w0.logs.txt`, error)
    const backend = file('backend.logs.txt', `${error}\n${error}`)
    expect(defaultLogFile([controller, w1, backend])).toBe(w1)
    expect(defaultLogFile([controller, w1, w0, backend])).toBe(w0)
    expect(defaultLogFile([controller, backend])).toBe(controller)
  })

  it('falls back to the first file without run files', () => {
    const backend = file('backend.logs.txt', error)
    expect(defaultLogFile([backend])).toBe(backend)
    expect(defaultLogFile([])).toBeUndefined()
  })
})

describe('locateFailure', () => {
  const file = (name: string, lines: Array<string>) =>
    parseLogFile({
      name,
      label: logFileLabel(name),
      group: logFileGroup(name),
      bytes: strToU8(lines.join('\n')),
    })
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
    expect(locateFailure(files, message)).toEqual({
      file: w1.file.name,
      line: 3,
    })
  })

  it('falls back to the controller, then the file with the most errors', () => {
    expect(locateFailure(files, 'OOM killed')).toEqual({
      file: controller.file.name,
      line: 2,
    })
    expect(locateFailure([w0, w1], 'OOM killed')).toEqual({
      file: w0.file.name,
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
  const backend = (lines: Array<string>) =>
    parseLogFile({
      name: 'backend.logs.txt',
      label: 'backend',
      group: 'server',
      bytes: strToU8(lines.join('\n')),
    })
  // Server at UTC+7.
  const fetchedAt = Date.parse('2026-11-08T01:16:10Z')
  const file = backend([
    '2026-11-08 08:10:00,000:INFO:uvicorn.error:1:Started server process',
    '2026-11-08 08:14:41,000:ERROR:forecastbox:1:compile failed',
    'Traceback (most recent call last):',
    '2026-11-08 08:16:09,500:INFO:forecastbox.routes.run:1:will fetch logs',
  ])

  it('reads entry times and carries them to continuation lines', () => {
    expect(file.lines[2].time).toBe(file.lines[1].time)
    expect(formatLogTime(file.lines[1].time ?? 0)).toBe('08:14:41')
  })

  it('finds the server clock offset from its newest line', () => {
    expect(serverClockOffset([file], fetchedAt)).toBe(7 * 3_600_000)
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
    expect(
      file.lines.filter((l) => inWindow(l, ended)).map((l) => l.number),
    ).toEqual([2, 3])
    const running = runWindow('2026-11-08T01:14:40+00:00', null, offset)
    if (!running) return
    expect(running.to).toBeNull()
    expect(file.lines.filter((l) => inWindow(l, running))).toHaveLength(3)
    expect(runWindow('not a date', null, offset)).toBeNull()
  })
})
