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
import type { MlModelOverview } from '@/api/types/artifacts.types'
import {
  MlModelOverviewSchema,
  toArtifactInfo,
} from '@/api/types/artifacts.types'

const baseOverview = {
  composite_id: { artifact_store_id: 'ecmwf', artifact_local_id: 'aifs-x' },
  display_name: 'AIFS X',
  display_author: 'ECMWF',
  disk_size_bytes: 1024,
  supported_platforms: ['linux'],
  tags: {},
  is_available: true,
  is_locally_compatible: true,
  local_compatibility_detail: null,
}

describe('MlModelOverviewSchema — tags', () => {
  it('accepts string and null tag values', () => {
    const parsed = MlModelOverviewSchema.parse({
      ...baseOverview,
      tags: { resolution: 'n320', experimental: null },
    })
    expect(parsed.tags).toEqual({ resolution: 'n320', experimental: null })
  })

  it('accepts an empty tags record', () => {
    expect(MlModelOverviewSchema.parse(baseOverview).tags).toEqual({})
  })

  it('rejects non-string tag values', () => {
    expect(() =>
      MlModelOverviewSchema.parse({
        ...baseOverview,
        tags: { count: 3 },
      }),
    ).toThrow()
  })
})

describe('toArtifactInfo', () => {
  it('carries tags through to the UI type', () => {
    const overview: MlModelOverview = {
      ...baseOverview,
      tags: { ensemble: null },
    }
    expect(toArtifactInfo(overview).tags).toEqual({ ensemble: null })
  })
})
