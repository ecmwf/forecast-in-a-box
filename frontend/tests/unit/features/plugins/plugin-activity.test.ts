/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import { ApiClientError } from '@/api/client'
import { pluginFailureDescription } from '@/features/plugins/utils/plugin-activity'
// Initialise i18next so the t() call resolves to a real string.
import '@/lib/i18n'

describe('pluginFailureDescription', () => {
  it('appends the reason the backend gave for refusing the update', () => {
    // What /plugin/update answers once no compatible version resolves.
    const error = new ApiClientError(
      "No compatible versions found for plugin 'ecmwf:ensemble'",
      400,
    )

    expect(pluginFailureDescription(error, 'Update failed')).toBe(
      "Update failed: No compatible versions found for plugin 'ecmwf:ensemble'",
    )
  })

  it('appends the reason for an unknown plugin', () => {
    const error = new ApiClientError("Plugin 'ecmwf:gone' not found", 404)

    expect(pluginFailureDescription(error, 'Update failed')).toBe(
      "Update failed: Plugin 'ecmwf:gone' not found",
    )
  })

  it('falls back to the plain label when the error carries no message', () => {
    expect(pluginFailureDescription(new Error(''), 'Install failed')).toBe(
      'Install failed',
    )
    expect(pluginFailureDescription(new Error('   '), 'Install failed')).toBe(
      'Install failed',
    )
  })

  it('falls back to the plain label for non-Error rejections', () => {
    expect(pluginFailureDescription('boom', 'Uninstall failed')).toBe(
      'Uninstall failed',
    )
    expect(pluginFailureDescription(undefined, 'Uninstall failed')).toBe(
      'Uninstall failed',
    )
  })
})
