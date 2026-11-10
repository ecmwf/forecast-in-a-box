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
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BlockInstance } from '@/api/types/fable.types'
import type { GlyphInfo } from '@/features/fable-builder/hooks/useAllGlyphs'
import { GlyphContext } from '@/features/fable-builder/context/GlyphContext'
import {
  useFileNameCheck,
  useOutputPathCheck,
} from '@/features/fable-builder/hooks/useOutputPathCheck'

const RUN = 'c34bba52-6932-4f1e-9d1a-0b6f2a7e1c55'

const GLYPHS: Array<GlyphInfo> = [
  {
    name: 'runId',
    displayName: 'Run ID',
    valueExample: RUN,
    type: 'intrinsic',
  },
]

function wrapper({ children }: { children: ReactNode }) {
  return (
    <GlyphContext.Provider value={GLYPHS}>{children}</GlyphContext.Provider>
  )
}

function block(factory: string, path: string): BlockInstance {
  return {
    factory_id: { plugin: { store: 'ecmwf', local: 'ecmwf' }, factory },
    configuration_values: { path },
    input_ids: {},
  }
}

interface Props {
  block: BlockInstance
  resolved: Record<string, string | null> | null
}

function renderCheck(initial: Props) {
  return renderHook(
    (p: Props) => useOutputPathCheck('sink1', p.block, p.resolved),
    { wrapper, initialProps: initial },
  )
}

describe('useOutputPathCheck', () => {
  it('flags a plain GRIB path and offers the run folder', () => {
    const { result } = renderCheck({
      block: block('gribSink', '/tmp/out/[shortName].grib'),
      resolved: null,
    })
    expect(result.current).toEqual({
      path: {
        scope: 'folder',
        fix: '/tmp/out/${runId}__${attemptCount}/[shortName].grib',
      },
    })
  })

  it('flags a per-run GRIB file name in a shared folder', () => {
    const value = '/tmp/myFunBlock-${runId}__${attemptCount}'
    const { result } = renderCheck({
      block: block('gribSink', value),
      resolved: { path: `/tmp/myFunBlock-${RUN}__1` },
    })
    expect(result.current).toEqual({
      path: {
        scope: 'folder',
        fix: '/tmp/${runId}__${attemptCount}/myFunBlock-${runId}__${attemptCount}',
      },
    })
    const zarr = renderCheck({
      block: block('zarrSink', value),
      resolved: { path: `/tmp/myFunBlock-${RUN}__1` },
    })
    expect(zarr.result.current).toBeNull()
  })

  it('trusts a literal runId glyph over a preview with another run ID', () => {
    const { result } = renderCheck({
      block: block('gribSink', '${outputRoot}/${runId}/[shortName].grib'),
      resolved: { path: '/tmp/outputRoot/9f0e7c1a/[shortName].grib' },
    })
    expect(result.current).toBeNull()
  })

  it('accepts a glyph path whose resolved folder carries the run ID', () => {
    const { result } = renderCheck({
      block: block('gribSink', '${outputRoot}/${runId}/[shortName].grib'),
      resolved: { path: `/tmp/outputRoot/${RUN}/[shortName].grib` },
    })
    expect(result.current).toBeNull()
  })

  it('keeps the last verdict while validation is in flight', () => {
    const shared = block('gribSink', '${outputRoot}/[shortName].grib')
    const { result, rerender } = renderCheck({
      block: shared,
      resolved: { path: '/tmp/outputRoot/[shortName].grib' },
    })
    expect(result.current).not.toBeNull()
    rerender({ block: shared, resolved: null })
    expect(result.current).not.toBeNull()
  })

  it('clears once the value names runId, even without a preview', () => {
    const { result, rerender } = renderCheck({
      block: block('gribSink', '/tmp/out/[shortName].grib'),
      resolved: null,
    })
    expect(result.current).not.toBeNull()
    rerender({
      block: block('gribSink', '/tmp/out/${runId}/[shortName].grib'),
      resolved: null,
    })
    expect(result.current).toBeNull()
  })

  it('ignores blocks that write nothing to disk', () => {
    const { result } = renderCheck({
      block: block('mapPlot', '/tmp/out.png'),
      resolved: null,
    })
    expect(result.current).toBeNull()
  })
})

describe('useFileNameCheck', () => {
  it('offers a file name for a GRIB path ending in a folder', () => {
    const { result } = renderHook(() =>
      useFileNameCheck(
        block('gribSink', '${outDir}/${runId}__${attemptCount}/'),
      ),
    )
    expect(result.current).toEqual({
      path: '${outDir}/${runId}__${attemptCount}/[shortName].grib',
    })
  })

  it('ignores GRIB file paths, Zarr stores and other blocks', () => {
    for (const b of [
      block('gribSink', '/tmp/out/[shortName].grib'),
      block('zarrSink', '/tmp/out/store.zarr/'),
      block('mapPlot', '/tmp/out/'),
    ]) {
      expect(renderHook(() => useFileNameCheck(b)).result.current).toBeNull()
    }
  })
})
