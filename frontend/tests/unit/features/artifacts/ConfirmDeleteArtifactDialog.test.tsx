/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@tests/utils/render'
import { ConfirmDeleteArtifactDialog } from '@/features/artifacts/components/ConfirmDeleteArtifactDialog'

const target = {
  id: { artifact_store_id: 'ecmwf', artifact_local_id: 'aifs-x' },
  name: 'AIFS X',
}

describe('ConfirmDeleteArtifactDialog', () => {
  // Browser-mode tests render without the app stylesheet, so the dialog loses
  // its Tailwind `fixed`/`z-50` positioning while Base UI's modal backdrop
  // keeps its inline `position: fixed`. Restore the dialog's production
  // stacking so the backdrop can't paint over the popup and swallow clicks.
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="alert-dialog-content"]{position:fixed;z-index:50}'
    document.head.appendChild(style)
  })

  it('renders nothing without a target', async () => {
    const screen = await renderWithProviders(
      <ConfirmDeleteArtifactDialog
        target={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText('Delete Model').elements()).toHaveLength(0)
  })

  it('shows title and the model name in the description', async () => {
    const screen = await renderWithProviders(
      <ConfirmDeleteArtifactDialog
        target={target}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    await expect.element(screen.getByText('Delete Model')).toBeVisible()
    await expect
      .element(screen.getByText(/Are you sure you want to delete AIFS X\?/))
      .toBeVisible()
  })

  it('confirm invokes onConfirm with the composite id', async () => {
    const onConfirm = vi.fn()
    const screen = await renderWithProviders(
      <ConfirmDeleteArtifactDialog
        target={target}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    )
    await screen.getByRole('button', { name: 'Delete' }).click()
    expect(onConfirm).toHaveBeenCalledWith(target.id)
  })

  it('cancel invokes onCancel without confirming', async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const screen = await renderWithProviders(
      <ConfirmDeleteArtifactDialog
        target={target}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
    await screen.getByRole('button', { name: 'Cancel' }).click()
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
