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
import type { PluginInfo } from '@/api/types/plugins.types'
import { compareInstalledPlugins } from '@/features/plugins/utils/plugin-sort'

function plugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id: { store: 'ecmwf', local: 'demo' },
    displayId: 'ecmwf/demo',
    name: 'Demo Plugin',
    description: '',
    author: 'ECMWF',
    version: '0.0.0',
    latestVersion: null,
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
    ...overrides,
  }
}

const names = (list: Array<PluginInfo>) =>
  [...list].sort(compareInstalledPlugins).map((p) => p.name)

describe('compareInstalledPlugins', () => {
  it('orders by name', () => {
    const list = [
      plugin({ name: 'ECMWF Plugin' }),
      plugin({ name: 'Demo Plugin' }),
    ]
    expect(names(list)).toEqual(['Demo Plugin', 'ECMWF Plugin'])
  })

  it('floats updatable plugins above the rest', () => {
    const list = [
      plugin({ name: 'Demo Plugin' }),
      plugin({ name: 'ECMWF Plugin', hasUpdate: true }),
    ]
    expect(names(list)).toEqual(['ECMWF Plugin', 'Demo Plugin'])
  })

  it('keeps a plugin in place when it is disabled', () => {
    const enabled = [
      plugin({ name: 'ECMWF Plugin', isEnabled: true }),
      plugin({ name: 'Demo Plugin', isEnabled: false }),
    ]
    const toggled = [
      plugin({ name: 'ECMWF Plugin', isEnabled: false }),
      plugin({ name: 'Demo Plugin', isEnabled: false }),
    ]
    expect(names(toggled)).toEqual(names(enabled))
  })
})
