/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Plugin mutations must invalidate the blueprint list: plugin templates are
 * ingested as `plugin_template` blueprint rows, so enabling or disabling a
 * plugin changes which of them exist. Without this the dashboard keeps serving
 * its cached list until a full page reload.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { fableKeys } from '@/api/hooks/useFable'
import { pluginKeys, useEnablePlugin } from '@/api/hooks/usePlugins'

vi.mock('@/utils/env', () => ({
  getBackendBaseUrl: vi.fn(() => ''),
}))

// The real action performs a settings POST then polls the catalogue back up;
// neither is what this test is about.
vi.mock('@/api/endpoints/plugins', async () => {
  const actual = await vi.importActual('@/api/endpoints/plugins')
  return {
    ...actual,
    enablePlugin: vi.fn(() => Promise.resolve()),
    getCatalogue: vi.fn(() => Promise.resolve({})),
  }
})

vi.mock('@/api/endpoints/fable', async () => {
  const actual = await vi.importActual('@/api/endpoints/fable')
  return { ...actual, getCatalogue: vi.fn(() => Promise.resolve({})) }
})

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidated: Array<string> = []
  const original = queryClient.invalidateQueries.bind(queryClient)
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push(JSON.stringify(filters?.queryKey))
    return original(filters)
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { invalidated, wrapper }
}

describe('plugin mutations', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('invalidates the blueprint list so plugin templates refresh', async () => {
    const { invalidated, wrapper } = harness()

    function Probe() {
      const enable = useEnablePlugin()
      const fired = useRef(false)
      useEffect(() => {
        if (fired.current) return
        fired.current = true
        enable.mutate({ store: 'ecmwf', local: 'ecmwf-base' })
      }, [enable])
      return null
    }

    render(<Probe />, { wrapper })

    await vi.waitFor(() => {
      expect(invalidated).toContain(JSON.stringify(fableKeys.blueprintsBase()))
    })
    // The pre-existing invalidations must survive alongside it.
    expect(invalidated).toContain(JSON.stringify(fableKeys.catalogue()))
    expect(invalidated).toContain(JSON.stringify(pluginKeys.list()))
  })
})
