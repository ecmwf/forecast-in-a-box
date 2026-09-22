/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Ordering for the installed-plugins table. */

import type { PluginInfo } from '@/api/types/plugins.types'

/**
 * Updatable first, then by name. Deliberately ignores `isEnabled`: sorting on
 * state the row's own toggle flips makes plugins jump position mid-interaction.
 */
export function compareInstalledPlugins(a: PluginInfo, b: PluginInfo): number {
  if (a.hasUpdate !== b.hasUpdate) {
    return a.hasUpdate ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}
