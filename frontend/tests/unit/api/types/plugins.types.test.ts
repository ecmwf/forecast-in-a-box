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
  pluginBadgeKind,
  pluginErrorsMaxSeverity,
  toPluginInfo,
  toPluginInfoList,
} from '@/api/types/plugins.types'

const ID: PluginCompositeId = { store: 'ecmwf', local: 'anemoi-inference' }

function detailWith(update_datetime: string | null): PluginDetail {
  if (update_datetime === null) {
    // Available (not installed) plugin — no install_data → updatedAt is null
    return {
      generic_data: { store_info: null, remote_info: null },
      install_data: null,
      settings_data: null,
      load_errors: [],
    }
  }
  return {
    generic_data: { store_info: null, remote_info: null },
    install_data: {
      local_version: '1.0.0',
      update_datetime,
      install_errors: [],
    },
    settings_data: {
      isEnabled: true,
      excluded_templates: [],
      included_templates: [],
      glyph_remapping: {},
    },
    load_errors: [],
  }
}

/** A loaded plugin with a fixed datetime — use as base where datetime is irrelevant */
const loadedDetail: PluginDetail = detailWith('2025-01-15T00:00:00+00:00')

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
  generic_data: { store_info: null, remote_info: null },
  install_data: {
    local_version: '1.0.0',
    update_datetime: '2025-01-15T00:00:00+00:00',
    install_errors: [],
  },
  settings_data: {
    isEnabled: true,
    excluded_templates: [],
    included_templates: [],
    glyph_remapping: {},
  },
  load_errors: [],
}

describe('PluginDetailSchema — load_errors parsing', () => {
  it('accepts an empty load_errors array', () => {
    const result = PluginDetailSchema.parse({ ...baseRaw, load_errors: [] })
    expect(result.load_errors).toEqual([])
  })

  it('preserves structured load errors', () => {
    const errors = [
      { source: 'load', detail: 'module failed', severity: 'error' },
      {
        source: 'template_ingest',
        detail: 'bad template',
        severity: 'warning',
      },
    ]
    const result = PluginDetailSchema.parse({ ...baseRaw, load_errors: errors })
    expect(result.load_errors).toEqual(errors)
  })
})

describe('toPluginInfo — errorDetail normalization', () => {
  it('normalizes empty install and load errors to null', () => {
    const info = toPluginInfo(ID, loadedDetail)
    expect(info.errorDetail).toBeNull()
    expect(info.errorSeverity).toBeNull()
  })

  it('surfaces load_errors and derives max severity', () => {
    const detail: PluginDetail = {
      ...loadedDetail,
      load_errors: [{ source: 'load', detail: 'boom', severity: 'error' }],
    }
    const info = toPluginInfo(ID, detail)
    expect(info.errorDetail).toEqual(detail.load_errors)
    expect(info.errorSeverity).toBe('error')
  })

  it('combines install_errors and load_errors', () => {
    const detail: PluginDetail = {
      ...loadedDetail,
      install_data: {
        local_version: '1.0.0',
        update_datetime: '2025-01-15T00:00:00+00:00',
        install_errors: [
          { source: 'install', detail: 'pip failed', severity: 'warning' },
        ],
      },
      load_errors: [{ source: 'load', detail: 'boom', severity: 'error' }],
    }
    const info = toPluginInfo(ID, detail)
    expect(info.errorDetail).toHaveLength(2)
    expect(info.errorSeverity).toBe('error')
  })
})

describe('toPluginInfo — isEnabled reflects settings_data.isEnabled', () => {
  it('is true for a loaded (enabled) plugin', () => {
    expect(toPluginInfo(ID, loadedDetail).isEnabled).toBe(true)
  })

  it('is false for a disabled plugin (settings_data.isEnabled = false)', () => {
    const disabled: PluginDetail = {
      ...loadedDetail,
      settings_data: {
        isEnabled: false,
        excluded_templates: [],
        included_templates: [],
        glyph_remapping: {},
      },
    }
    expect(toPluginInfo(ID, disabled).isEnabled).toBe(false)
  })

  it('is true for an errored plugin (install failed) to preserve errored badge', () => {
    const errored: PluginDetail = {
      generic_data: { store_info: null, remote_info: null },
      install_data: {
        local_version: '1.0.0',
        update_datetime: '2025-01-15T00:00:00+00:00',
        install_errors: [
          { source: 'install', detail: 'fail', severity: 'error' },
        ],
      },
      settings_data: null,
      load_errors: [],
    }
    expect(toPluginInfo(ID, errored).isEnabled).toBe(true)
  })
})

describe('toPluginInfoList — derives isEnabled from settings_data', () => {
  const key = "store='ecmwf' local='anemoi-inference'"

  it('reads isEnabled=false from settings_data', () => {
    const listing = {
      plugins: {
        [key]: {
          ...loadedDetail,
          settings_data: {
            isEnabled: false,
            excluded_templates: [],
            included_templates: [],
            glyph_remapping: {},
          },
        },
      },
    }
    const [info] = toPluginInfoList(listing)
    expect(info.isEnabled).toBe(false)
  })

  it('reads isEnabled=true from settings_data', () => {
    const listing = { plugins: { [key]: loadedDetail } }
    const [info] = toPluginInfoList(listing)
    expect(info.isEnabled).toBe(true)
  })
})

describe('pluginBadgeKind — one source of truth for badge + filter', () => {
  it('disabled dominates a loaded module (badge + filter agree)', () => {
    expect(pluginBadgeKind({ status: 'loaded', isEnabled: false })).toBe(
      'disabled',
    )
  })

  it('disabled dominates over a pending update and a warning', () => {
    expect(
      pluginBadgeKind({
        status: 'loaded',
        isEnabled: false,
        hasUpdate: true,
        errorSeverity: 'warning',
      }),
    ).toBe('disabled')
  })

  it('an uninstalled (available) plugin is not "disabled"', () => {
    expect(pluginBadgeKind({ status: 'available', isEnabled: false })).toBe(
      'available',
    )
  })

  it('a pending update on a loaded, enabled plugin → update', () => {
    expect(
      pluginBadgeKind({ status: 'loaded', isEnabled: true, hasUpdate: true }),
    ).toBe('update')
  })

  it('a warning drives the badge regardless of loaded/errored status', () => {
    expect(
      pluginBadgeKind({ status: 'loaded', errorSeverity: 'warning' }),
    ).toBe('warning')
    expect(
      pluginBadgeKind({ status: 'errored', errorSeverity: 'warning' }),
    ).toBe('warning')
  })

  it('an error/critical diagnostic → errored', () => {
    expect(pluginBadgeKind({ status: 'errored', errorSeverity: 'error' })).toBe(
      'errored',
    )
  })

  it('falls through to the plain status when nothing else applies', () => {
    expect(pluginBadgeKind({ status: 'loaded', isEnabled: true })).toBe(
      'loaded',
    )
    expect(pluginBadgeKind({ status: 'available' })).toBe('available')
    expect(pluginBadgeKind({ status: 'errored' })).toBe('errored')
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
      generic_data: { store_info: null, remote_info: { version: remote } },
      install_data: {
        local_version: loaded,
        update_datetime: '2025-01-15T00:00:00+00:00',
        install_errors: [],
      },
      settings_data: {
        isEnabled: true,
        excluded_templates: [],
        included_templates: [],
        glyph_remapping: {},
      },
      load_errors: [],
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

describe('parsePluginIdString', () => {
  it('splits a "store:local" composite string on the first colon', async () => {
    const { parsePluginIdString } = await import('@/api/types/plugins.types')
    expect(parsePluginIdString('local:plugin-test')).toEqual({
      store: 'local',
      local: 'plugin-test',
    })
    expect(parsePluginIdString('ecmwf:some:name')).toEqual({
      store: 'ecmwf',
      local: 'some:name',
    })
    expect(parsePluginIdString('no-colon')).toEqual({
      store: 'no-colon',
      local: '',
    })
  })
})
