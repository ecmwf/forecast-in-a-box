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
