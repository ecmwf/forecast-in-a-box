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
import type { PluginCompositeId, PluginDetail } from '@/api/types/plugins.types'
import {
  PluginDetailSchema,
  isNewerVersion,
  isUnstampedVersion,
  pluginErrorsMaxSeverity,
  toPluginInfo,
} from '@/api/types/plugins.types'

const ID: PluginCompositeId = { store: 'ecmwf', local: 'anemoi-inference' }

function detailWith(update_datetime: string | null): PluginDetail {
  return {
    status: 'loaded',
    store_info: null,
    remote_info: null,
    errored_detail: null,
    loaded_version: '1.0.0',
    update_datetime,
  }
}

describe('toPluginInfo — updatedAt timezone normalization', () => {
  // Naive backend datetime → append Z so it reads as UTC, not local.
  it('appends Z to a naive backend datetime (treated as UTC)', () => {
    expect(toPluginInfo(ID, detailWith('2025-01-15T00:00:00')).updatedAt).toBe(
      '2025-01-15T00:00:00Z',
    )
  })

  it('leaves an already Z-suffixed datetime untouched', () => {
    expect(toPluginInfo(ID, detailWith('2025-01-15T08:30:00Z')).updatedAt).toBe(
      '2025-01-15T08:30:00Z',
    )
  })

  it('leaves an offset-aware datetime untouched (forward-compat for tz support)', () => {
    expect(
      toPluginInfo(ID, detailWith('2025-01-15T08:30:00+02:00')).updatedAt,
    ).toBe('2025-01-15T08:30:00+02:00')
  })

  // The UTC-with-offset format the backend sends.
  it('leaves a +00:00 (UTC offset) datetime untouched', () => {
    expect(
      toPluginInfo(ID, detailWith('2025-01-15T08:30:00+00:00')).updatedAt,
    ).toBe('2025-01-15T08:30:00+00:00')
  })

  it('is null when the backend sends no datetime', () => {
    expect(toPluginInfo(ID, detailWith(null)).updatedAt).toBeNull()
  })

  it('is null for an unparseable datetime', () => {
    expect(toPluginInfo(ID, detailWith('not-a-date')).updatedAt).toBeNull()
  })
})

const baseRaw = {
  status: 'loaded' as const,
  store_info: null,
  remote_info: null,
  loaded_version: '1.0.0',
  update_datetime: null,
}

describe('PluginDetailSchema — errored_detail parsing', () => {
  it('accepts null and outputs null', () => {
    const result = PluginDetailSchema.parse({
      ...baseRaw,
      errored_detail: null,
    })
    expect(result.errored_detail).toBeNull()
  })

  it('preserves structured errors', () => {
    const errors = [
      { source: 'install', detail: 'pip failed', severity: 'error' },
      {
        source: 'template_ingest',
        detail: 'bad template',
        severity: 'warning',
      },
    ]
    const result = PluginDetailSchema.parse({
      ...baseRaw,
      errored_detail: errors,
    })
    expect(result.errored_detail).toEqual(errors)
  })
})

describe('toPluginInfo — errorDetail normalization', () => {
  it('normalizes an empty error list to null', () => {
    const info = toPluginInfo(ID, { ...detailWith(null), errored_detail: [] })
    expect(info.errorDetail).toBeNull()
    expect(info.errorSeverity).toBeNull()
  })

  it('passes structured errors through and derives the max severity', () => {
    const errors = [{ source: 'load', detail: 'boom', severity: 'error' }]
    const info = toPluginInfo(ID, {
      ...detailWith(null),
      errored_detail: errors,
    })
    expect(info.errorDetail).toEqual(errors)
    expect(info.errorSeverity).toBe('error')
  })
})

describe('pluginErrorsMaxSeverity', () => {
  it('returns null for an empty list', () => {
    expect(pluginErrorsMaxSeverity([])).toBeNull()
  })

  it('ranks critical > error > warning', () => {
    expect(
      pluginErrorsMaxSeverity([
        { source: 'load', detail: 'a', severity: 'warning' },
        { source: 'install', detail: 'b', severity: 'critical' },
        { source: 'load', detail: 'c', severity: 'error' },
      ]),
    ).toBe('critical')
  })

  it('is warning for a warning-only list', () => {
    expect(
      pluginErrorsMaxSeverity([
        { source: 'template_ingest', detail: 'a', severity: 'warning' },
        { source: 'template_ingest', detail: 'b', severity: 'warning' },
      ]),
    ).toBe('warning')
  })

  it('treats unknown severities as error', () => {
    expect(
      pluginErrorsMaxSeverity([
        { source: 'load', detail: 'a', severity: 'warning' },
        { source: 'load', detail: 'b', severity: 'fatal' },
      ]),
    ).toBe('error')
  })
})

describe('isNewerVersion', () => {
  it('detects a newer remote release', () => {
    expect(isNewerVersion('2.4.0', '2.1.0')).toBe(true)
  })

  it('compares segments numerically, not lexicographically', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true)
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false)
  })

  it('is false for equal versions, also with differing segment counts', () => {
    expect(isNewerVersion('1.2.0', '1.2.0')).toBe(false)
    expect(isNewerVersion('1.2', '1.2.0')).toBe(false)
    expect(isNewerVersion('1.2.0', '1.2')).toBe(false)
  })

  it('is false when the loaded version is newer (dev installs)', () => {
    expect(isNewerVersion('2.1.0', '2.4.0')).toBe(false)
  })

  it('is false for the backend "unknown" sentinel (failed PyPI lookup)', () => {
    expect(isNewerVersion('unknown', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', 'unknown')).toBe(false)
  })

  it('ignores pre-release suffixes (final does not out-rank its own rc)', () => {
    expect(isNewerVersion('1.2.3', '1.2.3rc1')).toBe(false)
    expect(isNewerVersion('1.2.4', '1.2.3rc1')).toBe(true)
  })
})

describe('toPluginInfo — hasUpdate', () => {
  function installedWith(loaded: string, remote: string): PluginDetail {
    return {
      ...detailWith(null),
      loaded_version: loaded,
      remote_info: { version: remote },
    }
  }

  it('flags an update when the remote release is newer', () => {
    expect(toPluginInfo(ID, installedWith('2.1.0', '2.4.0')).hasUpdate).toBe(
      true,
    )
  })

  it('does not flag when the remote version is "unknown"', () => {
    expect(toPluginInfo(ID, installedWith('2.1.0', 'unknown')).hasUpdate).toBe(
      false,
    )
  })

  it('does not flag when the loaded version is ahead of the remote', () => {
    expect(toPluginInfo(ID, installedWith('2.4.0', '2.1.0')).hasUpdate).toBe(
      false,
    )
  })

  it('does not flag against an unstamped (all-zero) dev install', () => {
    expect(toPluginInfo(ID, installedWith('0.0.0', '1.0.0')).hasUpdate).toBe(
      false,
    )
  })
})

describe('isUnstampedVersion', () => {
  it('detects all-zero versions', () => {
    expect(isUnstampedVersion('0.0.0')).toBe(true)
    expect(isUnstampedVersion('0.0')).toBe(true)
  })

  it('is false for stamped or unparseable versions', () => {
    expect(isUnstampedVersion('1.0.0')).toBe(false)
    expect(isUnstampedVersion('0.0.1')).toBe(false)
    expect(isUnstampedVersion('unknown')).toBe(false)
  })
})
