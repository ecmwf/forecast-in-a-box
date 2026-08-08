/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect } from 'react'
import { acquireNotificationSocket } from '@/api/notifications/socket'

/** Keeps the app-wide notification socket alive while mounted (refcounted; mount once in the authenticated layout). */
export function useNotificationSocket(): void {
  useEffect(() => acquireNotificationSocket(), [])
}
