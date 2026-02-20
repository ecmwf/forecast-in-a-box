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
 * API Endpoints Index
 *
 * Re-exports all endpoint functions for convenient importing.
 *
 * @example
 * import { getModels, getCatalogue, fetchStatus } from '@/api/endpoints'
 */

// Auth endpoints
export { checkSession, getAuthorizationUrl, logout } from './auth'

// Config endpoints
export { fetchConfigFromAPI, initializeConfig, refreshConfig } from './config'

// Fable endpoints
export {
  getCatalogue,
  expandFable,
  compileFable,
  retrieveFable,
  upsertFable,
} from './fable'

// Status endpoints
export { fetchStatus } from './status'

// Users endpoints
export { getCurrentUser } from './users'
