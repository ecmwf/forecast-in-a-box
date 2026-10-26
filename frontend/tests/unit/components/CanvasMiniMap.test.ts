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
  BLOCK_KIND_MINIMAP_COLOR,
  NEUTRAL_MINIMAP_COLOR,
  blockNodeMinimapColor,
} from '@/components/common/CanvasMiniMap'

describe('blockNodeMinimapColor', () => {
  it('maps the canvas node types onto the kind palette', () => {
    expect(blockNodeMinimapColor({ type: 'sourceBlock' })).toBe(
      BLOCK_KIND_MINIMAP_COLOR.source,
    )
    expect(blockNodeMinimapColor({ type: 'sinkBlock' })).toBe(
      BLOCK_KIND_MINIMAP_COLOR.sink,
    )
  })

  it('falls back to the neutral fill for other node types', () => {
    expect(blockNodeMinimapColor({ type: 'default' })).toBe(
      NEUTRAL_MINIMAP_COLOR,
    )
    expect(blockNodeMinimapColor({ type: undefined })).toBe(
      NEUTRAL_MINIMAP_COLOR,
    )
  })
})
