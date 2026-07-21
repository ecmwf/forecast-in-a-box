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
import { classifyOutput } from '@/features/executions/outputs/availability'

describe('classifyOutput', () => {
  it('reports available outputs regardless of the lost map', () => {
    expect(classifyOutput(true, 'task-1', { 'task-1': 'ignored' })).toEqual({
      state: 'available',
    })
  })

  it('reports lost with the backend reason when unavailable and in the lost map', () => {
    expect(
      classifyOutput(false, 'task-1', { 'task-1': 'Gateway Proc changed' }),
    ).toEqual({ state: 'lost', reason: 'Gateway Proc changed' })
  })

  it('reports pending when unavailable and not in the lost map', () => {
    expect(classifyOutput(false, 'task-1', {})).toEqual({ state: 'pending' })
  })
})
