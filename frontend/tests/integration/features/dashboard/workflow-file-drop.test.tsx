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
 * Dropping an exported workflow file on the dashboard's "Start from scratch"
 * card loads it onto the bench and opens the builder.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { GettingStartedSection } from '@/features/dashboard/components/GettingStartedSection'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useWorkbenchShelfStore } from '@/features/fable-builder/stores/workbenchShelfStore'
import { showToast } from '@/lib/toast'

vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

// Partial mock: the builder route is absent from the test router.
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mockNavigate,
}))

const anonymousAuth: AuthContextValue = {
  isLoading: false,
  isAuthenticated: true,
  authType: 'anonymous',
  signIn: () => {},
  signOut: () => Promise.resolve(),
}

const WORKFLOW = {
  blocks: {
    source: {
      factory_id: {
        plugin: { store: 'ecmwf', local: 'ecmwf-base' },
        factory: 'anemoiSource',
      },
      configuration_values: { lead_time: '72' },
      input_ids: {},
    },
  },
  environment: null,
  local_glyphs: {},
}

function fileTransfer(content: string): DataTransfer {
  const transfer = new DataTransfer()
  transfer.items.add(
    new File([content], 'uk_cutout_aifs_workflow.json', {
      type: 'application/json',
    }),
  )
  return transfer
}

function fire(
  target: Element,
  type: string,
  dataTransfer: DataTransfer,
  relatedTarget: EventTarget | null = null,
): DragEvent {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer,
    relatedTarget,
  })
  target.dispatchEvent(event)
  return event
}

async function renderSection() {
  const screen = await renderWithRouter(
    <AuthContext.Provider value={anonymousAuth}>
      <GettingStartedSection />
    </AuthContext.Provider>,
  )
  const card = screen.getByRole('button', { name: 'Start from scratch' })
  await expect.element(card).toBeVisible()
  return { screen, card: card.element() }
}

function dropOn(card: Element, transfer: DataTransfer): void {
  fire(card, 'dragenter', transfer)
  fire(card, 'dragover', transfer)
  fire(card, 'drop', transfer)
}

describe('Workflow file drop on Start from scratch', () => {
  beforeEach(() => {
    localStorage.clear()
    useFableBuilderStore.getState().reset()
    useWorkbenchShelfStore.getState().clear()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('shows the drop cue only while a file is over the card', async () => {
    const { screen, card } = await renderSection()
    const transfer = fileTransfer(JSON.stringify(WORKFLOW))
    const cue = screen.getByText('Drop to open this workflow')
    await expect.element(cue).not.toBeInTheDocument()

    fire(card, 'dragenter', transfer)
    await expect.element(cue).toBeVisible()

    fire(card, 'dragleave', transfer, document.body)
    await expect.element(cue).not.toBeInTheDocument()
  })

  it('loads a dropped workflow and opens the builder with the loaded check', async () => {
    const { card } = await renderSection()

    dropOn(card, fileTransfer(JSON.stringify(WORKFLOW)))

    await expect
      .poll(() => Object.keys(useFableBuilderStore.getState().fable.blocks))
      .toEqual(['source'])
    expect(useFableBuilderStore.getState().fableName).toBe('uk cutout aifs')
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/configure',
      search: { loaded: true },
    })
  })

  it('keeps the dashboard and says why when the file is not a workflow', async () => {
    const toastError = vi.spyOn(showToast, 'error')
    const { card } = await renderSection()

    dropOn(card, fileTransfer('{"blocks":[]}'))

    await expect
      .poll(() => toastError.mock.calls[0]?.[0])
      .toBe('Invalid workflow file')
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(useFableBuilderStore.getState().fable.blocks).toEqual({})
  })
})
