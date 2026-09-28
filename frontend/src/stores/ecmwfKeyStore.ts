/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The user's ECMWF API key for entitled ecCharts layers; this browser only. */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'

interface EcmwfKeyState {
  key: string | null
  /** Ephemeral: the key dialog is open (header menu or curated list). */
  dialogOpen: boolean
  setKey: (key: string) => void
  clearKey: () => void
  openDialog: () => void
  closeDialog: () => void
}

export const useEcmwfKeyStore = create<EcmwfKeyState>()(
  devtools(
    persist(
      (set) => ({
        key: null,
        dialogOpen: false,
        setKey: (key) => set({ key }, undefined, 'setKey'),
        clearKey: () => set({ key: null }, undefined, 'clearKey'),
        openDialog: () => set({ dialogOpen: true }, undefined, 'openDialog'),
        closeDialog: () => set({ dialogOpen: false }, undefined, 'closeDialog'),
      }),
      {
        name: STORAGE_KEYS.stores.ecmwfKey,
        version: STORE_VERSIONS.ecmwfKey,
        partialize: (state) => ({ key: state.key }),
      },
    ),
    { name: 'EcmwfKeyStore' },
  ),
)

export const useEcmwfKey = (): string | null =>
  useEcmwfKeyStore((state) => state.key)
