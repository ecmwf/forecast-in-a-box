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
 * Connection state of the notification WebSocket. Written by the socket
 * transport; read wherever push-vs-poll behaviour matters.
 */

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export type NotificationConnectionStatus =
  /** No consumer holds the socket (logged out / not mounted). */
  | 'idle'
  /** First connection attempt, nothing received yet. */
  | 'connecting'
  /** Live push channel. */
  | 'connected'
  /** Connection lost while consumers exist — reconnecting, polling covers. */
  | 'degraded'

interface NotificationState {
  status: NotificationConnectionStatus
  setStatus: (status: NotificationConnectionStatus) => void
}

export const useNotificationStore = create<NotificationState>()(
  devtools(
    (set) => ({
      status: 'idle',
      setStatus: (status) => set({ status }, undefined, 'setStatus'),
    }),
    { name: 'NotificationStore' },
  ),
)
