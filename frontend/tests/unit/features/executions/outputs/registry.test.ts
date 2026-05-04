/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Box } from 'lucide-react'
import { afterEach, describe, expect, it } from 'vitest'
import type { OutputAdapter } from '@/features/executions/outputs/types'
import {
  GENERIC_ADAPTER,
  _resetRegistryForTests,
  registerOutputAdapter,
  resolveAdapter,
} from '@/features/executions/outputs/registry'

function makeAdapter(overrides: Partial<OutputAdapter>): OutputAdapter {
  return {
    id: 'test',
    mimeTypes: ['test/test'],
    icon: Box,
    label: () => 'test',
    chipClass: 'bg-slate-100',
    extension: 'bin',
    actions: [],
    ...overrides,
  }
}

describe('output adapter registry', () => {
  afterEach(() => {
    _resetRegistryForTests()
  })

  it('returns GENERIC_ADAPTER for unknown MIMEs', () => {
    expect(resolveAdapter('totally/unknown')).toBe(GENERIC_ADAPTER)
  })

  it('returns the registered adapter for an exact MIME match', () => {
    const adapter = makeAdapter({ id: 'a', mimeTypes: ['app/a'] })
    registerOutputAdapter(adapter)
    expect(resolveAdapter('app/a')).toBe(adapter)
  })

  it('matches on any of the adapter aliases', () => {
    const adapter = makeAdapter({
      id: 'aliased',
      mimeTypes: ['image/x', 'image/y'],
    })
    registerOutputAdapter(adapter)
    expect(resolveAdapter('image/x')).toBe(adapter)
    expect(resolveAdapter('image/y')).toBe(adapter)
    expect(resolveAdapter('image/z')).toBe(GENERIC_ADAPTER)
  })

  it('throws when registering a duplicate id', () => {
    registerOutputAdapter(makeAdapter({ id: 'dup', mimeTypes: ['m/1'] }))
    expect(() =>
      registerOutputAdapter(makeAdapter({ id: 'dup', mimeTypes: ['m/2'] })),
    ).toThrow(/dup/)
  })

  it('throws when two adapters claim the same MIME', () => {
    registerOutputAdapter(makeAdapter({ id: 'first', mimeTypes: ['m/x'] }))
    expect(() =>
      registerOutputAdapter(makeAdapter({ id: 'second', mimeTypes: ['m/x'] })),
    ).toThrow(/m\/x/)
  })
})
