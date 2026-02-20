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
 * Status feature store
 * Manages status-related state using Zustand
 */

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { StatusResponse } from '@/types/status.types'

interface StatusState {
  // Current status data
  status: StatusResponse | null
  setStatus: (status: StatusResponse) => void

  // Last updated timestamp
  lastUpdated: Date | null
  setLastUpdated: (date: Date) => void

  // Reset store
  reset: () => void
}

const initialState = {
  status: null,
  lastUpdated: null,
}

export const useStatusStore = create<StatusState>()(
  devtools(
    (set) => ({
      ...initialState,

      setStatus: (status) =>
        set({
          status,
          lastUpdated: new Date(),
        }),

      reset: () => set(initialState),
    }),
    { name: 'StatusStore' },
  ),
)
