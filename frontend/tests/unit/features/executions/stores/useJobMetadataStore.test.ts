/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { JobMetadata } from '@/features/executions/stores/useJobMetadataStore'
import { useJobMetadataStore } from '@/features/executions/stores/useJobMetadataStore'

function createMetadata(overrides?: Partial<JobMetadata>): JobMetadata {
  return {
    name: 'Test Job',
    description: 'A test job description',
    tags: ['tag1', 'tag2'],
    fableId: 'fable-123',
    fableName: 'Test Fable',
    fableSnapshot: { blocks: {} },
    submittedAt: '2026-01-15T10:00:00Z',
    ...overrides,
  }
}

describe('useJobMetadataStore', () => {
  beforeEach(() => {
    useJobMetadataStore.setState({ jobs: {} })
  })

  describe('addJob', () => {
    it('adds a job to the store', () => {
      const metadata = createMetadata()
      useJobMetadataStore.getState().addJob('job-1', metadata)

      expect(useJobMetadataStore.getState().jobs['job-1']).toEqual(metadata)
    })

    it('adds multiple jobs', () => {
      useJobMetadataStore
        .getState()
        .addJob('job-1', createMetadata({ name: 'Job 1' }))
      useJobMetadataStore
        .getState()
        .addJob('job-2', createMetadata({ name: 'Job 2' }))

      expect(Object.keys(useJobMetadataStore.getState().jobs)).toHaveLength(2)
      expect(useJobMetadataStore.getState().jobs['job-1'].name).toBe('Job 1')
      expect(useJobMetadataStore.getState().jobs['job-2'].name).toBe('Job 2')
    })

    it('overwrites existing job with same id', () => {
      useJobMetadataStore
        .getState()
        .addJob('job-1', createMetadata({ name: 'Original' }))
      useJobMetadataStore
        .getState()
        .addJob('job-1', createMetadata({ name: 'Updated' }))

      expect(useJobMetadataStore.getState().jobs['job-1'].name).toBe('Updated')
      expect(Object.keys(useJobMetadataStore.getState().jobs)).toHaveLength(1)
    })
  })

  describe('updateJob', () => {
    it('updates the name of an existing job', () => {
      useJobMetadataStore
        .getState()
        .addJob('job-1', createMetadata({ name: 'Original' }))
      useJobMetadataStore.getState().updateJob('job-1', { name: 'Renamed' })

      expect(useJobMetadataStore.getState().jobs['job-1'].name).toBe('Renamed')
    })

    it('updates the description of an existing job', () => {
      useJobMetadataStore
        .getState()
        .addJob('job-1', createMetadata({ description: 'Old desc' }))
      useJobMetadataStore
        .getState()
        .updateJob('job-1', { description: 'New desc' })

      expect(useJobMetadataStore.getState().jobs['job-1'].description).toBe(
        'New desc',
      )
    })

    it('updates the tags of an existing job', () => {
      useJobMetadataStore
        .getState()
        .addJob('job-1', createMetadata({ tags: ['old'] }))
      useJobMetadataStore
        .getState()
        .updateJob('job-1', { tags: ['new1', 'new2'] })

      expect(useJobMetadataStore.getState().jobs['job-1'].tags).toEqual([
        'new1',
        'new2',
      ])
    })

    it('preserves fields not included in the patch', () => {
      const metadata = createMetadata({
        name: 'Original',
        description: 'Desc',
        tags: ['t1'],
        fableId: 'fable-abc',
      })
      useJobMetadataStore.getState().addJob('job-1', metadata)
      useJobMetadataStore.getState().updateJob('job-1', { name: 'Changed' })

      const updated = useJobMetadataStore.getState().jobs['job-1']
      expect(updated.name).toBe('Changed')
      expect(updated.description).toBe('Desc')
      expect(updated.tags).toEqual(['t1'])
      expect(updated.fableId).toBe('fable-abc')
      expect(updated.fableSnapshot).toEqual({ blocks: {} })
    })

    it('can update multiple fields at once', () => {
      useJobMetadataStore.getState().addJob('job-1', createMetadata())
      useJobMetadataStore.getState().updateJob('job-1', {
        name: 'New Name',
        description: 'New Desc',
        tags: ['a', 'b', 'c'],
      })

      const updated = useJobMetadataStore.getState().jobs['job-1']
      expect(updated.name).toBe('New Name')
      expect(updated.description).toBe('New Desc')
      expect(updated.tags).toEqual(['a', 'b', 'c'])
    })
  })

  describe('removeJob', () => {
    it('removes a job from the store', () => {
      useJobMetadataStore.getState().addJob('job-1', createMetadata())
      useJobMetadataStore.getState().removeJob('job-1')

      expect(useJobMetadataStore.getState().jobs['job-1']).toBeUndefined()
    })

    it('does not affect other jobs when removing', () => {
      useJobMetadataStore
        .getState()
        .addJob('job-1', createMetadata({ name: 'Job 1' }))
      useJobMetadataStore
        .getState()
        .addJob('job-2', createMetadata({ name: 'Job 2' }))
      useJobMetadataStore.getState().removeJob('job-1')

      expect(useJobMetadataStore.getState().jobs['job-1']).toBeUndefined()
      expect(useJobMetadataStore.getState().jobs['job-2'].name).toBe('Job 2')
    })
  })

  describe('getJob', () => {
    it('returns the job metadata for a valid id', () => {
      const metadata = createMetadata({ name: 'Found Job' })
      useJobMetadataStore.getState().addJob('job-1', metadata)

      expect(useJobMetadataStore.getState().getJob('job-1')).toEqual(metadata)
    })

    it('returns undefined for a nonexistent id', () => {
      expect(
        useJobMetadataStore.getState().getJob('nonexistent'),
      ).toBeUndefined()
    })
  })
})
