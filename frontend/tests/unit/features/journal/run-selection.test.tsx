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
import { renderHook } from 'vitest-browser-react'
import { act } from 'react'
import type { ForecastRunViewModel } from '@/features/journal/types'
import { useRunSelection } from '@/features/journal/hooks/useRunSelection'

const run = (runId: string) => ({ runId }) as ForecastRunViewModel

describe('useRunSelection', () => {
  it('keeps the picked runs themselves, capped, until cleared', async () => {
    const { result } = await renderHook(() => useRunSelection(2))

    act(() => result.current.toggle(run('a')))
    act(() => result.current.toggle(run('b')))
    act(() => result.current.toggle(run('c')))

    expect(result.current.selectedRuns.map((r) => r.runId)).toEqual(['a', 'b'])
    expect(result.current.selectedIds.has('c')).toBe(false)

    act(() => result.current.toggle(run('a')))
    expect(result.current.selectedRuns.map((r) => r.runId)).toEqual(['b'])

    act(() => result.current.clear())
    expect(result.current.selectedRuns).toEqual([])
  })
})
