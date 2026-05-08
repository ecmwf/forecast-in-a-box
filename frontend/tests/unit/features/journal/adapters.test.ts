/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Journal adapter Unit Tests — runDetailToViewModel. */

import { describe, expect, it } from 'vitest'
import type { JobExecutionDetail } from '@/api/types/job.types'
import type {
  BlockFactoryCatalogue,
  BlockInstance,
  FableRetrieveResponse,
} from '@/api/types/fable.types'
import { runDetailToViewModel } from '@/features/journal/adapters'
import { ONEOFF_TAG } from '@/lib/system-tags'

const catalogue: BlockFactoryCatalogue = {
  'test/plugin': {
    factories: {
      modelSrc: {
        kind: 'source',
        title: 'AIFS Single',
        description: '',
        configuration_options: {},
        inputs: [],
      },
      pngSink: {
        kind: 'sink',
        title: 'PNG Map',
        description: '',
        configuration_options: {},
        inputs: ['data'],
      },
    },
  },
}

function blockInstance(factory: string): BlockInstance {
  return {
    factory_id: { plugin: { store: 'test', local: 'plugin' }, factory },
    configuration_values: {},
    input_ids: {},
  }
}

const blueprint: FableRetrieveResponse = {
  blueprint_id: 'bp-1',
  version: 1,
  builder: {
    blocks: {
      s1: blockInstance('modelSrc'),
      o1: blockInstance('pngSink'),
      o2: blockInstance('pngSink'),
    },
    local_glyphs: {},
  },
  display_name: 'Europe Forecast',
  display_description: null,
  tags: ['europe', ONEOFF_TAG],
}

const baseRun: JobExecutionDetail = {
  run_id: 'run-1',
  attempt_count: 1,
  status: 'running',
  created_at: '2026-05-16T10:00:00Z',
  updated_at: '2026-05-16T10:05:00Z',
  blueprint_id: 'bp-1',
  blueprint_version: 1,
  error: null,
  progress: '42.5',
  cascade_job_id: null,
  outputs: null,
}

describe('runDetailToViewModel', () => {
  it('maps the run and blueprint into the view model', () => {
    const vm = runDetailToViewModel({
      run: baseRun,
      blueprint,
      catalogue,
      isBookmarked: true,
    })
    expect(vm.runId).toBe('run-1')
    expect(vm.displayName).toBe('Europe Forecast')
    expect(vm.displayDescription).toBeNull()
    expect(vm.fromPreset).toBe(false)
    expect(vm.status).toBe('running')
    expect(vm.blueprintId).toBe('bp-1')
    expect(vm.isBookmarked).toBe(true)
  })

  it('derives the model label from the first source block', () => {
    const vm = runDetailToViewModel({
      run: baseRun,
      blueprint,
      catalogue,
      isBookmarked: false,
    })
    expect(vm.modelLabel).toBe('AIFS Single')
  })

  it('falls back to the sink-block count when the run has no outputs', () => {
    const vm = runDetailToViewModel({
      run: baseRun,
      blueprint,
      catalogue,
      isBookmarked: false,
    })
    expect(vm.outputCount).toBe(2)
  })

  it('counts produced artifacts when the run has outputs', () => {
    const vm = runDetailToViewModel({
      run: {
        ...baseRun,
        outputs: {
          byTask: {
            'task-a': {
              mime_type: 'image/png',
              original_block: 'o1',
              is_available: true,
            },
            'task-b': {
              mime_type: 'image/png',
              original_block: 'o1',
              is_available: true,
            },
            'task-c': {
              mime_type: 'application/pdf',
              original_block: 'o2',
              is_available: true,
            },
          },
          stored: {},
        },
      },
      blueprint,
      catalogue,
      isBookmarked: false,
    })
    expect(vm.outputCount).toBe(3)
  })

  it('derives output kinds from the sink-block titles', () => {
    const vm = runDetailToViewModel({
      run: baseRun,
      blueprint,
      catalogue,
      isBookmarked: false,
    })
    expect(vm.outputKinds).toEqual(['PNG Map'])
  })

  it('maps the blueprint description', () => {
    const vm = runDetailToViewModel({
      run: baseRun,
      blueprint: { ...blueprint, display_description: 'Weekly Europe run' },
      catalogue,
      isBookmarked: false,
    })
    expect(vm.displayDescription).toBe('Weekly Europe run')
  })

  it('strips internal system marker tags', () => {
    const vm = runDetailToViewModel({
      run: baseRun,
      blueprint,
      catalogue,
      isBookmarked: false,
    })
    expect(vm.tags).toEqual(['europe'])
  })

  it('parses and clamps the progress string', () => {
    const progressOf = (progress: string | null) =>
      runDetailToViewModel({
        run: { ...baseRun, progress },
        blueprint,
        catalogue,
        isBookmarked: false,
      }).progress
    expect(progressOf('42.5')).toBe(42.5)
    expect(progressOf(null)).toBe(0)
    expect(progressOf('150')).toBe(100)
  })

  it('falls back gracefully when the blueprint has not loaded', () => {
    const vm = runDetailToViewModel({
      run: baseRun,
      blueprint: undefined,
      catalogue,
      isBookmarked: false,
    })
    expect(vm.displayName).toBe('')
    expect(vm.displayDescription).toBeNull()
    expect(vm.modelLabel).toBeNull()
    expect(vm.outputCount).toBe(0)
    expect(vm.outputKinds).toEqual([])
    expect(vm.tags).toEqual([])
  })
})
