/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it, vi } from 'vitest'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import {
  decodeFableFromURL,
  encodeFableToURL,
} from '@/features/fable-builder/utils/url-state'
import { encodeStateToURL } from '@/lib/url-state'

// Silence the expected decode warning on the legacy-format case.
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const fableWithBlocks: FableBuilderV1 = {
  blocks: {
    source1: {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'core' },
        factory: 'mars',
      },
      configuration_values: { base_time: '2026-05-15T00:00:00' },
      input_ids: {},
    },
    sink1: {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'core' },
        factory: 'plot',
      },
      configuration_values: { param: '2t' },
      input_ids: { data: 'source1' },
    },
  },
  local_glyphs: { region: 'europe' },
}

describe('fable URL state round-trip', () => {
  // Guards the schema asymmetry: encode must emit the list form decode expects.
  it('round-trips a fable with blocks through encode → decode', () => {
    const decoded = decodeFableFromURL(encodeFableToURL(fableWithBlocks))
    expect(decoded).toEqual(fableWithBlocks)
  })

  it('round-trips an empty fable', () => {
    const empty: FableBuilderV1 = { blocks: {}, local_glyphs: {} }
    expect(decodeFableFromURL(encodeFableToURL(empty))).toEqual(empty)
  })

  it('rejects the legacy dict-form payload rather than mis-parsing it', () => {
    // Pre-#534 URLs encoded blocks as a dict; the schema now expects a list.
    const legacy = encodeStateToURL({ blocks: fableWithBlocks.blocks })
    expect(decodeFableFromURL(legacy)).toBeNull()
  })

  it('returns null for undecodable input', () => {
    expect(decodeFableFromURL('not-a-valid-encoded-state')).toBeNull()
  })
})
