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
 * MSW Handlers Index
 *
 * Exports all request handlers for MSW
 */

import { authHandlers } from './auth.handlers'
import { configHandlers } from './config.handlers'
import { fableHandlers } from './fable.handlers'
import { gatewayHandlers } from './gateway.handlers'
import { jobHandlers } from './job.handlers'
import { pluginsHandlers } from './plugins.handlers'
import { sourcesHandlers } from './sources.handlers'
import { statusHandlers } from './status.handlers'
import { usersHandlers } from './users.handlers'

export const handlers = [
  ...authHandlers,
  ...configHandlers,
  ...fableHandlers,
  ...gatewayHandlers,
  ...jobHandlers,
  ...pluginsHandlers,
  ...sourcesHandlers,
  ...statusHandlers,
  ...usersHandlers,
]
