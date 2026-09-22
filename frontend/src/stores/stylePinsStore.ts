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
 * Pinned default WMS style per server scope and layer; seeds newly active
 * layers, a URL style wins. All lens runs share one scope.
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'
import { isLensProxyUrl } from '@/features/viewer/wms-capabilities'

/** Store scope for a source: `lens` for any lens proxy, else the URL. */
export function styleScope(baseUrl: string): string {
  return isLensProxyUrl(baseUrl) ? 'lens' : baseUrl
}

/** Record key for a pin. */
export const stylePinKey = (scope: string, layer: string): string =>
  `${scope}|${layer}`

interface StylePinsState {
  /** `${scope}|${layerName}` → style name. */
  pins: Record<string, string>
  pin: (scope: string, layer: string, style: string) => void
  unpin: (scope: string, layer: string) => void
  pinned: (scope: string, layer: string) => string | null
  reset: () => void
}

export const useStylePinsStore = create<StylePinsState>()(
  devtools(
    persist(
      (set, get) => ({
        pins: {},
        pin: (scope, layer, style) =>
          set((state) => ({
            pins: { ...state.pins, [stylePinKey(scope, layer)]: style },
          })),
        unpin: (scope, layer) =>
          set((state) => {
            const pins = { ...state.pins }
            delete pins[stylePinKey(scope, layer)]
            return { pins }
          }),
        pinned: (scope, layer) => get().pins[stylePinKey(scope, layer)] ?? null,
        reset: () => set({ pins: {} }),
      }),
      {
        name: STORAGE_KEYS.stores.stylePins,
        version: STORE_VERSIONS.stylePins,
        partialize: (state) => ({ pins: state.pins }),
      },
    ),
    { name: 'StylePinsStore' },
  ),
)
