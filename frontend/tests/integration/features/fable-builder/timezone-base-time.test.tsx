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
 * Wire-contract test: a forecast base time is transmitted to the backend as
 * the canonical naive-UTC string, untouched by the application timezone.
 *
 * `DateTimeField` produces the canonical-UTC value (see date-time-field.test);
 * this test verifies the store -> upsert -> wire path never re-converts it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import { renderWithRouter } from '@tests/utils/render'
import { worker } from '@tests/test-extend'
import type { FableUpsertRequest } from '@/api/types/fable.types'
import { API_ENDPOINTS } from '@/api/endpoints'
import { FableBuilderPage } from '@/features/fable-builder/components/FableBuilderPage'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useUiStore } from '@/stores/uiStore'

vi.mock('@/hooks/useMedia', () => ({ useMedia: () => true }))
vi.mock('@/features/fable-builder/hooks/useURLStateSync', () => ({
  useURLStateSync: () => ({ loadedFromURL: false }),
}))
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ authType: 'anonymous', isAuthenticated: true }),
}))
vi.mock('@/hooks/useUser', () => ({
  useUser: () => ({ data: { is_superuser: true } }),
}))

function seedSourceBlock() {
  useFableBuilderStore.getState().setFable({
    blocks: {
      source1: {
        factory_id: {
          plugin: { store: 'ecmwf', local: 'ecmwf-base' },
          factory: 'ekdSource',
        },
        configuration_values: { source: 'mars', expver: '0001' },
        input_ids: {},
      },
    },
  })
}

/** Intercept the next blueprint upsert and expose its request body. */
function captureUpsert() {
  let captured: FableUpsertRequest | null = null
  worker.use(
    http.post(API_ENDPOINTS.fable.create, async ({ request }) => {
      captured = (await request.json()) as FableUpsertRequest
      return HttpResponse.json({ blueprint_id: 'fable-tz-test', version: 1 })
    }),
  )
  return () => captured
}

describe('Fable Builder — base time wire contract', () => {
  beforeEach(() => {
    localStorage.clear()
    useFableBuilderStore.getState().reset()
    useUiStore.getState().reset()
    vi.clearAllMocks()
  })

  it('transmits the canonical UTC base time verbatim', async () => {
    useUiStore.setState({ timeZone: 'UTC' })
    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    seedSourceBlock()
    useFableBuilderStore
      .getState()
      .updateBlockConfig('source1', 'base_time', '2026-05-15T00:00:00')

    const body = captureUpsert()
    await screen.getByRole('button', { name: /Save Config/i }).click()
    await screen.getByLabelText('Title').fill('Timezone Test UTC')
    await screen.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(() => useFableBuilderStore.getState().isDirty, { timeout: 3000 })
      .toBe(false)

    expect(body()?.builder.blocks.source1.configuration_values.base_time).toBe(
      '2026-05-15T00:00:00',
    )
  })

  it('does not re-convert the base time for the presentation timezone', async () => {
    // A Berlin user entering 2026-05-15 00:00 stores 2026-05-14T22:00:00 (UTC).
    // The upsert must send that canonical value untouched — never local time.
    useUiStore.setState({ timeZone: 'Europe/Berlin' })
    const screen = await renderWithRouter(<FableBuilderPage />)
    await expect.element(screen.getByText('Block Palette')).toBeVisible()

    seedSourceBlock()
    useFableBuilderStore
      .getState()
      .updateBlockConfig('source1', 'base_time', '2026-05-14T22:00:00')

    const body = captureUpsert()
    await screen.getByRole('button', { name: /Save Config/i }).click()
    await screen.getByLabelText('Title').fill('Timezone Test Berlin')
    await screen.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(() => useFableBuilderStore.getState().isDirty, { timeout: 3000 })
      .toBe(false)

    expect(body()?.builder.blocks.source1.configuration_values.base_time).toBe(
      '2026-05-14T22:00:00',
    )
  })
})
