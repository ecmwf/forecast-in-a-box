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
 * Mock of the backend's server-push-only notification channel. Other
 * handlers push events via `broadcastClientNotification`.
 */

import { ws } from 'msw'
import type { ClientNotification } from '@/api/types/notification.types'
import { API_ENDPOINTS } from '@/api/endpoints'

// Leading `*` matches any scheme://host:port (dev, e2e and vitest all differ)
const notificationSocket = ws.link(`*${API_ENDPOINTS.notification.ws}`)

/** Push a notification to every connected mock client. */
export function broadcastClientNotification(
  notification: ClientNotification,
): void {
  notificationSocket.broadcast(JSON.stringify(notification))
}

export const notificationHandlers = [
  notificationSocket.addEventListener('connection', () => {
    // Server-push only — client messages are ignored, as on the backend.
  }),
]
