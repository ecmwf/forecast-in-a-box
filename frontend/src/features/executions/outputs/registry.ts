/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { FileDown } from 'lucide-react'
import { downloadAction } from './actions/download'
import type { OutputAdapter } from './types'

const adapters = new Map<string, OutputAdapter>()
const adaptersById = new Map<string, OutputAdapter>()

/**
 * Generic fallback adapter — always present, returned when no registered
 * adapter matches the item's MIME. Download-only, no viewer, no thumbnail.
 */
export const GENERIC_ADAPTER: OutputAdapter = {
  id: 'generic',
  mimeTypes: ['*'],
  icon: FileDown,
  label: (t) => t('outputs.adapters.generic.label'),
  shortLabel: (t) => t('outputs.adapters.generic.label'),
  chipClass:
    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  extension: 'bin',
  actions: [downloadAction],
}

/** Register a first-party adapter. Throws on duplicate id or MIME. */
export function registerOutputAdapter(adapter: OutputAdapter): void {
  if (adaptersById.has(adapter.id)) {
    throw new Error(`OutputAdapter "${adapter.id}" already registered`)
  }
  for (const mime of adapter.mimeTypes) {
    if (adapters.has(mime)) {
      const existing = adapters.get(mime)
      throw new Error(
        `MIME "${mime}" already claimed by adapter "${existing?.id}" (registering "${adapter.id}")`,
      )
    }
  }
  adaptersById.set(adapter.id, adapter)
  for (const mime of adapter.mimeTypes) {
    adapters.set(mime, adapter)
  }
}

/** Resolve the adapter for a MIME, falling back to GENERIC_ADAPTER. */
export function resolveAdapter(mime: string): OutputAdapter {
  return adapters.get(mime) ?? GENERIC_ADAPTER
}

/** Test-only: clear the registry so tests can self-register fixtures. */
export function _resetRegistryForTests(): void {
  adapters.clear()
  adaptersById.clear()
}
