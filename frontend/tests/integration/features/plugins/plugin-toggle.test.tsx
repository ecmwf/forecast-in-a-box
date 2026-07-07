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
 * PluginToggle Integration Tests
 *
 * The enable/disable switch and its in-flight feedback: while a toggle is
 * pending it shows the target position optimistically, disables input, and
 * spins.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { PluginInfo } from '@/api/types/plugins.types'
import { PluginToggle } from '@/features/plugins/components/PluginToggle'

const basePlugin: PluginInfo = {
  id: { store: 'ecmwf', local: 'ecmwf-base' },
  displayId: 'ecmwf/ecmwf-base',
  name: 'ECMWF Plugin',
  description: '',
  author: 'ECMWF',
  version: '0.0.1',
  latestVersion: '0.0.1',
  capabilities: [],
  status: 'loaded',
  isEnabled: true,
  isInstalled: true,
  hasUpdate: false,
  updatedAt: null,
  errorDetail: null,
  errorSeverity: null,
  comment: null,
  pipSource: null,
  moduleName: null,
}

describe('PluginToggle', () => {
  it('is idle when no toggle is pending — enabled, no spinner', async () => {
    const screen = await renderWithRouter(
      <PluginToggle plugin={basePlugin} onToggle={vi.fn()} />,
    )
    await expect.element(screen.getByRole('switch')).not.toBeDisabled()
    expect(screen.getByRole('status').query()).toBeNull()
  })

  it('while enabling: shows the target ON optimistically, disabled, spinning', async () => {
    const disabled: PluginInfo = { ...basePlugin, isEnabled: false }
    const screen = await renderWithRouter(
      <PluginToggle plugin={disabled} pendingEnabled onToggle={vi.fn()} />,
    )
    const toggle = screen.getByRole('switch')
    await expect.element(toggle).toBeDisabled()
    // Optimistic: reads ON even though the plugin is still disabled in data.
    await expect.element(toggle).toHaveAttribute('aria-checked', 'true')
    await expect.element(screen.getByRole('status')).toBeVisible()
  })

  it('while disabling: shows the target OFF optimistically, disabled', async () => {
    const screen = await renderWithRouter(
      <PluginToggle
        plugin={basePlugin}
        pendingEnabled={false}
        onToggle={vi.fn()}
      />,
    )
    const toggle = screen.getByRole('switch')
    await expect.element(toggle).toBeDisabled()
    await expect.element(toggle).toHaveAttribute('aria-checked', 'false')
    await expect.element(screen.getByRole('status')).toBeVisible()
  })
})
