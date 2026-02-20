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
 * Command Store
 *
 * Manages the command palette open/close state.
 * No persistence needed - palette should always start closed.
 */

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface CommandState {
  /** Whether the command palette is open */
  isOpen: boolean
  /** Set the open state */
  setOpen: (open: boolean) => void
  /** Toggle the open state */
  toggle: () => void
  /** Reset to initial state */
  reset: () => void
}

const initialState = {
  isOpen: false,
}

export const useCommandStore = create<CommandState>()(
  devtools(
    (set) => ({
      ...initialState,
      setOpen: (isOpen) => set({ isOpen }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      reset: () => set(initialState),
    }),
    { name: 'CommandStore' },
  ),
)
