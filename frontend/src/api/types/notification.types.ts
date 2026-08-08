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
 * Wire schema for the backend's ClientNotification (WS /notification/ws).
 * Fields are camelCase on the wire, unlike the snake_case REST API;
 * context is event-specific, so it stays an open record.
 */

import { z } from 'zod'

export const clientNotificationSchema = z.object({
  /** Full display text (untranslated backend English — fallback only). */
  text: z.string(),
  /** Domain as understood by the backend: artifact, plugin, run, ... */
  sourceDomainName: z.string(),
  /** Event name within the domain, e.g. artifactDownloadFinished. */
  sourceDomainEvent: z.string(),
  /** Event-specific payload. */
  context: z.record(z.string(), z.unknown()),
  /** Optional backend route with more detail (not directly visitable). */
  detailRoute: z.string().nullable(),
  /** Backend routes whose data this event staled, e.g. "api/v1/artifacts/list_models". */
  refreshRoutes: z.array(z.string()),
})

export type ClientNotification = z.infer<typeof clientNotificationSchema>
