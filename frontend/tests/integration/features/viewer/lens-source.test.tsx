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
 * useLensSource capabilities retry ladder: the backend reports a lens
 * `running` when the process spawns, but SkinnyWMS serves its WMS port
 * seconds later — early 503s must be retried away, not parked on.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import {
  registerMockWmsServer,
  wmsCapabilitiesRequestCount,
} from '@tests/../mocks/data/wms.data'
import { useLensSource } from '@/features/viewer/hooks/useLensSource'

function Probe({ port }: { port: number }) {
  const source = useLensSource(`http://localhost:${port}`)
  return (
    <output data-testid="state">
      {source.layers.length > 0
        ? `ready:${source.layers.map((l) => l.name).join(',')}`
        : source.retrying
          ? 'retrying'
          : source.error
            ? 'error'
            : 'pending'}
    </output>
  )
}

describe('useLensSource cold-boot retry', () => {
  it('retries early 503s away and serves the capabilities', async () => {
    const port = 21900
    // Two boot-race failures before the server responds (see
    // MockWmsServerConfig.failuresBeforeSuccess) — the 300/600 ms rungs
    // must absorb them without surfacing an error.
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature' }],
      failuresBeforeSuccess: 2,
    })
    const queryClient = new QueryClient()
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <Probe port={port} />
      </QueryClientProvider>,
    )

    await expect
      .poll(() => screen.getByTestId('state').element().textContent, {
        timeout: 8000,
      })
      .toBe('ready:2t')
    expect(wmsCapabilitiesRequestCount(port)).toBe(3)
  })
})
