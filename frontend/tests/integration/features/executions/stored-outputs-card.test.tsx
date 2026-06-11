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
 * StoredOutputsCard Integration Tests
 *
 * Exercises the disk-written-sink card against the MSW lens handlers:
 * - row derivation (server-authoritative `stored` map vs fable-walk fallback)
 * - unavailable files disable the lens actions
 * - the copy action: start lens → poll until running → row shows the
 *   running badge with port → Stop tears the instance down
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { listMockLenses, resetLensState } from '@tests/../mocks/data/lens.data'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { RunOutputs } from '@/api/types/job.types'
import { StoredOutputsCard } from '@/features/executions/components/StoredOutputsCard'
import i18n from '@/lib/i18n'

const catalogue: BlockFactoryCatalogue = {
  'ecmwf/ecmwf-base': {
    factories: {
      gribSink: {
        kind: 'sink',
        title: 'GRIB Sink',
        description: 'Write dataset to a GRIB file',
        configuration_options: {
          path: { title: 'Path', description: 'Path', value_type: 'str' },
        },
        inputs: ['dataset'],
      },
      mapPlotSink: {
        kind: 'sink',
        title: 'Map Plot',
        description: 'Render a map',
        configuration_options: {},
        inputs: ['dataset'],
      },
    },
  },
}

const fable: FableBuilderV1 = {
  blocks: {
    sink_grib: {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'ecmwf-base' },
        factory: 'gribSink',
      },
      configuration_values: { path: '/tmp/run-1__[shortName].grib2' },
      input_ids: { dataset: 'source_1' },
    },
    sink_plot: {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'ecmwf-base' },
        factory: 'mapPlotSink',
      },
      configuration_values: {},
      input_ids: { dataset: 'source_1' },
    },
  },
}

const storedAvailable: RunOutputs['stored'] = {
  sink_grib: { path: '/data/out/run-1__2t.grib2', is_available: true },
}

async function renderCard(storedOutputs?: RunOutputs['stored']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return await render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <StoredOutputsCard
          fable={fable}
          catalogue={catalogue}
          storedOutputs={storedOutputs}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetLensState()
})

describe('StoredOutputsCard', () => {
  it('prefers server-reported paths and skips path-less sinks', async () => {
    const screen = await renderCard(storedAvailable)
    // Path renders split: emphasized filename + dimmed directory.
    await expect.element(screen.getByText('run-1__2t.grib2')).toBeVisible()
    await expect.element(screen.getByText('/data/out/')).toBeVisible()
    expect(screen.getByText('GRIB', { exact: true }).elements()).toHaveLength(1)
    // mapPlotSink has no path config and no stored entry — not listed.
    expect(screen.getByText('Map Plot').elements()).toHaveLength(0)
  })

  it('falls back to the fable-configured path without server data', async () => {
    const screen = await renderCard()
    await expect
      .element(screen.getByText('run-1__[shortName].grib2'))
      .toBeVisible()
    await expect.element(screen.getByText('/tmp/')).toBeVisible()
  })

  it('disables lens actions when the file is reported missing', async () => {
    const screen = await renderCard({
      sink_grib: { path: '/data/out/gone.grib2', is_available: false },
    })
    const openButton = screen.getByRole('button', { name: /^open/i })
    await expect.element(openButton).toBeDisabled()
  })

  it('copy starts the lens, the row shows a running badge, Stop tears it down', async () => {
    const screen = await renderCard(storedAvailable)

    await screen.getByRole('button', { name: /copy wms url/i }).click()

    // Lens starts in `starting`, flips to running on a later poll; the row
    // badge then reports the assigned port.
    await expect.element(screen.getByText(/WMS running :54300/)).toBeVisible()
    expect(listMockLenses()).toHaveLength(1)
    expect(listMockLenses()[0].status).toBe('running')

    await screen.getByRole('button', { name: /^stop$/i }).click()
    await expect
      .element(screen.getByText(/WMS running/))
      .not.toBeInTheDocument()
    // The stop request settles asynchronously after the badge clears.
    await expect.poll(() => listMockLenses()).toHaveLength(0)
  })
})
