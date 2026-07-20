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
 * useWmsLayerStack load-failure safeguard: a layer whose GetMap fails is
 * hidden and counted, so a stale image can never pose as the requested
 * instant — and render churn must never turn into request churn. Uses a
 * real, inline-sized OL map (browser tests have no Tailwind, so the
 * viewer's own containers collapse to 0×0).
 */

import { useEffect, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import OlMap from 'ol/Map'
import View from 'ol/View'
import {
  getMapRequests,
  registerMockWmsServer,
} from '@tests/../mocks/data/wms.data'
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'
import { useWmsLayerStack } from '@/features/viewer/hooks/useWmsLayerStack'

let nextPort = 21800

const T00 = '2026-07-06T00:00:00Z'
const T06 = '2026-07-06T06:00:00Z'

const LAYER: ParsedLayer = {
  name: '2t',
  title: '2 m temperature',
  styles: [],
  time: { raw: `${T00},${T06}` },
}

const noop = () => {}

type LoadResult = [string, string | null, boolean]

function Harness({
  port,
  time,
  nonce = 0,
  onLoadResult,
}: {
  port: number
  time: string
  /** Bumping forces a re-render without changing any request input. */
  nonce?: number
  onLoadResult?: (layer: string, time: string | null, ok: boolean) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const [, setReady] = useState(false)

  useEffect(() => {
    const map = new OlMap({
      target: containerRef.current!,
      view: new View({ center: [0, 0], zoom: 1 }),
      controls: [],
    })
    mapRef.current = map
    setReady(true)
    return () => map.setTarget(undefined)
  }, [])

  const stack = useWmsLayerStack(mapRef, `http://localhost:${port}`, [LAYER], {
    masterOpacity: 1,
    activeOrder: ['2t'],
    layerOpacities: new Map(),
    // Deliberately a fresh closure every render — the real viewer churns
    // identities too, and the stack must absorb that without refetching.
    resolveTime: () => time,
    incLoading: noop,
    decLoading: noop,
    onLoadResult,
  })

  return (
    <div data-nonce={nonce}>
      <div
        ref={containerRef}
        style={{ width: 300, height: 200, position: 'relative' }}
      />
      <output data-testid="errors">{stack.errorCount}</output>
      <output data-testid="visible">
        {String(stack.stackRef.current[0]?.getVisible() ?? 'none')}
      </output>
    </div>
  )
}

describe('useWmsLayerStack load failures', () => {
  it('hides errored layers, counts them, and recovers on success', async () => {
    const port = nextPort++
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature', time: `${T00},${T06}` }],
      // Stale-capabilities server: T06 advertised but not served.
      failGetMapTimes: [T06],
    })

    const results: Array<LoadResult> = []
    const onLoadResult = (layer: string, time: string | null, ok: boolean) => {
      results.push([layer, time, ok])
    }

    const screen = await render(
      <Harness port={port} time={T00} onLoadResult={onLoadResult} />,
    )
    await expect
      .poll(() => getMapRequests(port).length, { timeout: 8000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => screen.getByTestId('errors').element().textContent, {
        timeout: 8000,
      })
      .toBe('0')

    // Switch to the failing instant → hidden + counted.
    await screen.rerender(
      <Harness port={port} time={T06} onLoadResult={onLoadResult} />,
    )
    await expect
      .poll(() => screen.getByTestId('errors').element().textContent, {
        timeout: 8000,
      })
      .toBe('1')
    expect(screen.getByTestId('visible').element().textContent).toBe('false')

    // Back to the good instant → recovered and visible again.
    await screen.rerender(
      <Harness port={port} time={T00} onLoadResult={onLoadResult} />,
    )
    await expect
      .poll(() => screen.getByTestId('errors').element().textContent, {
        timeout: 8000,
      })
      .toBe('0')
    expect(screen.getByTestId('visible').element().textContent).toBe('true')

    // Load outcomes were reported with the exact requested TIME.
    expect(results).toContainEqual(['2t', T06, false])
    expect(results).toContainEqual(['2t', T00, true])
    expect(results.at(-1)).toEqual(['2t', T00, true])
  })

  it('render churn never re-requests — especially not an errored layer', async () => {
    const port = nextPort++
    registerMockWmsServer(port, {
      layers: [{ name: '2t', title: '2 m temperature', time: `${T00},${T06}` }],
      failGetMapTimes: [T06],
    })

    // Straight onto the failing instant.
    const screen = await render(<Harness port={port} time={T06} />)
    await expect
      .poll(() => screen.getByTestId('errors').element().textContent, {
        timeout: 8000,
      })
      .toBe('1')
    const requestsAfterError = getMapRequests(port).length

    // Re-renders with unchanged request inputs (fresh resolver closures)
    // must not touch the network — this was a live retry-loop bug.
    for (const nonce of [1, 2, 3]) {
      await screen.rerender(<Harness port={port} time={T06} nonce={nonce} />)
    }
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(getMapRequests(port).length).toBe(requestsAfterError)
    expect(screen.getByTestId('visible').element().textContent).toBe('false')

    // A real params change still retries and recovers.
    await screen.rerender(<Harness port={port} time={T00} nonce={4} />)
    await expect
      .poll(() => screen.getByTestId('errors').element().textContent, {
        timeout: 8000,
      })
      .toBe('0')
  })
})
