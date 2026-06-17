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
import { toPluginInfo } from '@/api/types/plugins.types'

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
