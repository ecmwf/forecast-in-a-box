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
import {
  allowedHostPath,
  decodeEntryRef,
  entryDisplayName,
  entryRef,
  redactWmsUrl,
  wmsUrlIsPrivate,
} from '@/features/visualise/entry-ref'

const outputEntry = {
  kind: 'output' as const,
  jobId: '4808b259-cd35-44a7-a203-94471659fc2f',
  taskId: 'task_out-1.2',
  blockId: 'block_sink_1',
  runName: 'Anemoi Model Source',
  blockTitle: 'GRIB Sink',
  runCreatedAt: null,
}

describe('entryRef / decodeEntryRef', () => {
  it('round-trips output refs with ids containing - _ .', () => {
    const ref = entryRef(outputEntry)
    expect(ref).toBe(`run:${outputEntry.jobId}~${outputEntry.taskId}`)
    expect(decodeEntryRef(ref)).toEqual({
      kind: 'output',
      jobId: outputEntry.jobId,
      taskId: outputEntry.taskId,
    })
  })

  it('round-trips wms refs', () => {
    const url = 'http://localhost:19001'
    expect(decodeEntryRef(entryRef({ kind: 'wms', url, label: 'x' }))).toEqual({
      kind: 'wms',
      url,
    })
  })

  it('serializes path entries as stable opaque digests, never the raw path', () => {
    const path = '/Users/x/.fiab/jobs_output/4af24cc6_1'
    const ref = entryRef({ kind: 'path', path, label: 'x' })
    expect(ref).toMatch(/^dir:[0-9a-f]{8}$/)
    expect(ref).not.toContain(path)
    // Stable across sessions and distinct per path.
    expect(entryRef({ kind: 'path', path, label: 'other' })).toBe(ref)
    expect(entryRef({ kind: 'path', path: '/elsewhere', label: 'x' })).not.toBe(
      ref,
    )
    expect(decodeEntryRef(ref)).toEqual({
      kind: 'dir',
      digest: ref.slice('dir:'.length),
    })
  })

  it('serializes credential-bearing wms entries as opaque digests', () => {
    const url = 'https://maps.example.org/wms?dataset=x&token=SECRET'
    const ref = entryRef({ kind: 'wms', url, label: 'x' })
    expect(ref).toMatch(/^wmsp:[0-9a-f]{8}$/)
    expect(ref).not.toContain('SECRET')
    expect(entryRef({ kind: 'wms', url, label: 'y' })).toBe(ref)
    expect(decodeEntryRef(ref)).toEqual({
      kind: 'wmsp',
      digest: ref.slice('wmsp:'.length),
    })
  })

  it('keeps curated endpoints shareable despite their public token', () => {
    const url = 'https://eccharts.ecmwf.int/wms/?token=public'
    expect(entryRef({ kind: 'wms', url, label: 'x' })).toBe(`wms:${url}`)
  })

  it('classifies wms urls by credential params and userinfo', () => {
    expect(wmsUrlIsPrivate('https://x.org/wms?api_key=k')).toBe(true)
    expect(wmsUrlIsPrivate('https://x.org/wms?apikey=k')).toBe(true)
    expect(wmsUrlIsPrivate('https://user:pw@x.org/wms')).toBe(true)
    expect(wmsUrlIsPrivate('https://x.org/wms?dataset=OBS')).toBe(false)
    expect(wmsUrlIsPrivate('not a url')).toBe(true)
  })

  it('redacts secret values for display; public urls pass through', () => {
    expect(redactWmsUrl('https://x.org/wms?dataset=a&token=SECRET')).toBe(
      'https://x.org/wms?dataset=a&token=***',
    )
    const publicUrl = 'https://x.org/wms?dataset=OBS'
    expect(redactWmsUrl(publicUrl)).toBe(publicUrl)
  })

  it('still decodes legacy raw path refs (consent-gated inbound links)', () => {
    expect(decodeEntryRef('path:/data/grib')).toEqual({
      kind: 'path',
      path: '/data/grib',
    })
  })

  it('rejects malformed refs', () => {
    expect(decodeEntryRef('run:no-separator')).toBeNull()
    expect(decodeEntryRef('run:~task-only')).toBeNull()
    expect(decodeEntryRef('run:job-only~')).toBeNull()
    expect(decodeEntryRef('dir:')).toBeNull()
    expect(decodeEntryRef('wmsp:')).toBeNull()
    expect(decodeEntryRef('path:')).toBeNull()
    expect(decodeEntryRef('wms:')).toBeNull()
    expect(decodeEntryRef('bogus:x')).toBeNull()
    expect(decodeEntryRef('')).toBeNull()
  })

  it('allows only absolute, traversal-free host paths', () => {
    expect(allowedHostPath('/data/grib')).toBe('/data/grib')
    expect(allowedHostPath('  /data/grib ')).toBe('/data/grib')
    expect(allowedHostPath('/data/..grib/x')).toBe('/data/..grib/x')
    expect(allowedHostPath('relative/path')).toBeNull()
    expect(allowedHostPath('../etc')).toBeNull()
    expect(allowedHostPath('/data/../etc/passwd')).toBeNull()
    expect(allowedHostPath('')).toBeNull()
  })

  it('derives display names per kind', () => {
    expect(entryDisplayName(outputEntry)).toBe('Anemoi Model Source')
    expect(entryDisplayName({ ...outputEntry, runName: '' })).toBe('GRIB Sink')
    expect(
      entryDisplayName({ ...outputEntry, runName: '', blockTitle: '' }),
    ).toBe('4808b259')
    expect(
      entryDisplayName({ kind: 'path', path: '/p', label: 'My data' }),
    ).toBe('My data')
  })
})
