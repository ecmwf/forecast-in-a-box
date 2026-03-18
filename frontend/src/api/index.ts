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
 * API Layer - Central Exports
 *
 * Centralized API layer following the documented architecture.
 * Exports:
 * - API client
 * - All endpoint functions
 * - API hooks (when implemented)
 * - API types (re-exported for convenience)
 */

// Client
export { apiClient, ApiClientError } from './client'

// Endpoints
export * from './endpoints/config'
export * from './endpoints/fable'
export * from './endpoints/status'

// Hooks
export * from './hooks/useFable'
export * from './hooks/useStatus'
