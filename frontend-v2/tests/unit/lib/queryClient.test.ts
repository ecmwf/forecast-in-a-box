/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/queryClient'

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

describe('queryClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clear any cached queries
    queryClient.clear()
  })

  describe('initialization', () => {
    it('exports queryClient instance', () => {
      expect(queryClient).toBeDefined()
    })

    it('has query cache', () => {
      expect(queryClient.getQueryCache()).toBeDefined()
    })

    it('has mutation cache', () => {
      expect(queryClient.getMutationCache()).toBeDefined()
    })
  })

  describe('default options', () => {
    it('has default stale time configured', () => {
      const defaults = queryClient.getDefaultOptions()
      expect(defaults.queries?.staleTime).toBeDefined()
    })

    it('has default gc time configured', () => {
      const defaults = queryClient.getDefaultOptions()
      expect(defaults.queries?.gcTime).toBeDefined()
    })

    it('has retry configured', () => {
      const defaults = queryClient.getDefaultOptions()
      expect(defaults.queries?.retry).toBeDefined()
    })
  })

  describe('query management', () => {
    it('can set and get query data', () => {
      queryClient.setQueryData(['test-key'], { data: 'test-value' })
      const data = queryClient.getQueryData(['test-key'])
      expect(data).toEqual({ data: 'test-value' })
    })

    it('can invalidate queries', async () => {
      queryClient.setQueryData(['test-key'], { data: 'test-value' })
      await queryClient.invalidateQueries({ queryKey: ['test-key'] })

      const query = queryClient.getQueryCache().find({ queryKey: ['test-key'] })
      expect(query?.state.isInvalidated).toBe(true)
    })

    it('can clear all queries', () => {
      queryClient.setQueryData(['key1'], { data: 1 })
      queryClient.setQueryData(['key2'], { data: 2 })

      queryClient.clear()

      expect(queryClient.getQueryData(['key1'])).toBeUndefined()
      expect(queryClient.getQueryData(['key2'])).toBeUndefined()
    })
  })

  describe('query cache', () => {
    it('caches query results', () => {
      queryClient.setQueryData(['cached-query'], { result: 'cached' })

      const cache = queryClient.getQueryCache()
      const query = cache.find({ queryKey: ['cached-query'] })

      expect(query).toBeDefined()
      expect(query?.state.data).toEqual({ result: 'cached' })
    })

    it('can find queries by partial key', () => {
      queryClient.setQueryData(['users', 'list'], { users: [] })
      queryClient.setQueryData(['users', 'detail', '1'], { id: '1' })

      const cache = queryClient.getQueryCache()
      const queries = cache.findAll({ queryKey: ['users'] })

      expect(queries.length).toBe(2)
    })
  })
})
