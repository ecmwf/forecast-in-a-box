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
  isSharedAcrossRuns,
  namesRunId,
  runScopedPath,
  withRunFolder,
} from '@/features/fable-builder/utils/run-folder-nudge'

const RUN = 'c34bba52-6932-4f1e-9d1a-0b6f2a7e1c55'

describe('runScopedPath', () => {
  it('knows the GRIB and Zarr sinks', () => {
    const plugin = { store: 'ecmwf', local: 'ecmwf' }
    expect(runScopedPath({ plugin, factory: 'gribSink' })).toEqual({
      configKey: 'path',
      scope: 'folder',
    })
    expect(runScopedPath({ plugin, factory: 'zarrSink' })).toEqual({
      configKey: 'path',
      scope: 'path',
    })
    expect(runScopedPath({ plugin, factory: 'mapPlot' })).toBeNull()
  })
})

describe('isSharedAcrossRuns', () => {
  it('accepts a GRIB folder carrying the run ID', () => {
    expect(
      isSharedAcrossRuns(
        `/tmp/outputRoot/${RUN}__1/[shortName].grib`,
        RUN,
        'folder',
      ),
    ).toBe(false)
  })

  it('flags a GRIB folder without the run ID', () => {
    expect(
      isSharedAcrossRuns('/tmp/outputRoot/[shortName].grib', RUN, 'folder'),
    ).toBe(true)
  })

  it('flags a GRIB file named after the run in a shared folder', () => {
    expect(isSharedAcrossRuns(`/tmp/${RUN}.grib`, RUN, 'folder')).toBe(true)
  })

  it('accepts a Zarr store named after the run', () => {
    expect(isSharedAcrossRuns(`/tmp/${RUN}.zarr`, RUN, 'path')).toBe(false)
    expect(isSharedAcrossRuns('/tmp/out.zarr', RUN, 'path')).toBe(true)
  })
})

describe('namesRunId', () => {
  it('finds the runId glyph in the folder only', () => {
    expect(
      namesRunId('${root}/${runId}__${attemptCount}/x.grib', 'folder'),
    ).toBe(true)
    expect(namesRunId('${root}/${ runId | upper }/x.grib', 'folder')).toBe(true)
    expect(namesRunId('${root}/${runId}.grib', 'folder')).toBe(false)
    expect(namesRunId('${root}/${runIdx}/x.grib', 'folder')).toBe(false)
    expect(namesRunId('${root}/${runId}.zarr', 'path')).toBe(true)
  })
})

describe('withRunFolder', () => {
  it('inserts the run folder before the file name', () => {
    expect(withRunFolder('${outputRoot}/[shortName].grib')).toBe(
      '${outputRoot}/${runId}__${attemptCount}/[shortName].grib',
    )
    expect(withRunFolder('/tmp/out.zarr')).toBe(
      '/tmp/${runId}__${attemptCount}/out.zarr',
    )
  })

  it('skips a slash inside a glyph', () => {
    expect(withRunFolder("/data/${a | replace('/', '_')}.grib")).toBe(
      "/data/${runId}__${attemptCount}/${a | replace('/', '_')}.grib",
    )
  })

  it('offers no fix without a slash outside glyphs', () => {
    expect(withRunFolder('${outputRoot}')).toBeNull()
    expect(withRunFolder('out.grib')).toBeNull()
  })
})
