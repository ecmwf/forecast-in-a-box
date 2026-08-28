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
 * seconds later — early 503s must be retried away, not parked on. Our own
 * lens (reached via the proxy path) gets the patient ladder; an external
 * WMS gets the snappy one — this asserts the patient ladder actually
 * outlasts the snappy one, not just that some retrying happens.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import {
  registerMockWmsServer,
  wmsCapabilitiesRequestCount,
} from '@tests/../mocks/data/wms.data'
import { buildLensBaseUrl } from '@/api/endpoints/lens'
import { useLensSource } from '@/features/viewer/hooks/useLensSource'

function Probe({ baseUrl }: { baseUrl: string }) {
  const source = useLensSource(baseUrl)
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
  it('outlasts the snappy external ladder for our own lens proxy base', async () => {
    const lensId = 'lens-cold-boot'
    const baseUrl = buildLensBaseUrl(lensId)
    // 6 boot-race failures before the server responds: the external ladder
    // (5 retries, 6 attempts total) would give up before this succeeds —
    // only the lens proxy's patient ladder (10 retries) absorbs it.
    registerMockWmsServer(lensId, {
      layers: [{ name: '2t', title: '2 m temperature' }],
      failuresBeforeSuccess: 6,
    })
    const queryClient = new QueryClient()
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <Probe baseUrl={baseUrl} />
      </QueryClientProvider>,
    )

    await expect
      .poll(() => screen.getByTestId('state').element().textContent, {
        timeout: 20000,
      })
      .toBe('ready:2t')
    expect(wmsCapabilitiesRequestCount(lensId)).toBe(7)
  })
})
