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
import { render } from 'vitest-browser-react'
import type { GlobeViewProps } from '@/features/viewer/globe/GlobeView'
import { LazyGlobeView } from '@/features/viewer/globe/LazyGlobeView'

const chunk = vi.hoisted(() => ({ fail: true }))

// The chunk's first mount fails, as a lost context or a bad style would make it.
vi.mock('@/features/viewer/globe/GlobeView', () => ({
  GlobeView: () => {
    if (chunk.fail) throw new Error('chunk lost')
    return <div data-testid="globe-view" />
  },
}))

describe('LazyGlobeView', () => {
  it('reports a failed mount and renders afresh on the next one', async () => {
    const onFailure = vi.fn()
    const props = { onFailure } as unknown as GlobeViewProps
    const first = await render(<LazyGlobeView {...props} />)
    await expect.poll(() => onFailure.mock.calls.length).toBe(1)
    expect(document.querySelector('[data-testid="globe-view"]')).toBeNull()
    await first.unmount()
    chunk.fail = false

    const second = await render(<LazyGlobeView {...props} />)
    await expect.element(second.getByTestId('globe-view')).toBeInTheDocument()
    expect(onFailure).toHaveBeenCalledTimes(1)
  })
})
