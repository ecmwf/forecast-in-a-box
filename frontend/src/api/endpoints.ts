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
 * API Endpoints - Single Source of Truth
 *
 * All API endpoint paths are defined here. Import and use these
 * constants instead of hardcoding paths.
 *
 * Key conventions:
 * - `API_ENDPOINTS`: For production code - static paths or functions for dynamic paths
 * - `API_PATTERNS`: For MSW mock handlers - uses `:param` syntax for path matching
 *
 * @see AGENTS.md for documentation on API endpoint conventions
 */

/**
 * API version
 */
export const API_VERSION = 'v1'

/**
 * API path prefix (includes version)
 */
export const API_PREFIX = `/api/${API_VERSION}`

/**
 * All API endpoint paths for production code
 *
 * Static endpoints are strings, dynamic endpoints are functions.
 *
 * Usage:
 * ```typescript
 * import { API_ENDPOINTS } from '@/api/endpoints'
 *
 * // Static endpoint
 * apiClient.get(API_ENDPOINTS.status)
 *
 * // Dynamic endpoint
 * apiClient.get(API_ENDPOINTS.job.statusById(jobId))
 * ```
 */
export const API_ENDPOINTS = {
  /**
   * System status endpoint
   */
  status: `${API_PREFIX}/status`,

  /**
   * Fable (configuration builder) endpoints
   */
  fable: {
    /** GET - Get block catalogue */
    catalogue: `${API_PREFIX}/fable/catalogue`,
    /** PUT - Expand a fable configuration */
    expand: `${API_PREFIX}/fable/expand`,
    /** GET - Retrieve a saved fable with metadata */
    retrieve: `${API_PREFIX}/fable/retrieve`,
    /** POST - Create or update a fable with metadata (returns { id, version }) */
    upsert: `${API_PREFIX}/fable/upsert`,
    /** PUT - Compile a fable by persisted reference */
    compile: `${API_PREFIX}/fable/compile`,
  },

  /**
   * Admin/configuration endpoints
   */
  admin: {
    /** GET - Get UI configuration */
    uiConfig: `${API_PREFIX}/admin/uiConfig`,
  },

  /**
   * User endpoints
   */
  users: {
    /** GET - Get current user info */
    me: `${API_PREFIX}/users/me`,
  },

  /**
   * Authentication endpoints
   */
  auth: {
    /** POST - Logout current session */
    logout: `${API_PREFIX}/auth/logout`,
    // Note: OIDC authorize endpoint comes from backend config (loginEndpoint)
  },

  /**
   * Plugin management endpoints
   *
   * Note: Uses singular "plugin" not "plugins" to match backend.
   * POST endpoints use request body for PluginCompositeId (except modifyEnabled which also uses query param).
   */
  plugin: {
    /** GET - Get plugin system status */
    status: `${API_PREFIX}/plugin/status`,
    /** GET - Get all plugin details */
    details: `${API_PREFIX}/plugin/details`,
    /** POST - Install a plugin (body: PluginCompositeId) */
    install: `${API_PREFIX}/plugin/install`,
    /** POST - Uninstall a plugin (body: PluginCompositeId) */
    uninstall: `${API_PREFIX}/plugin/uninstall`,
    /** POST - Update a plugin (body: PluginCompositeId) */
    update: `${API_PREFIX}/plugin/update`,
    /** POST - Enable/disable a plugin (body: PluginCompositeId, query: isEnabled) */
    modifyEnabled: `${API_PREFIX}/plugin/modifyEnabled`,
  },

  /**
   * Artifacts (ML models) management endpoints
   */
  artifacts: {
    /** GET - List all models */
    listModels: `${API_PREFIX}/artifacts/list_models`,
    /** POST - Get model details (body: CompositeArtifactId) */
    modelDetails: `${API_PREFIX}/artifacts/model_details`,
    /** POST - Download a model (body: CompositeArtifactId) */
    downloadModel: `${API_PREFIX}/artifacts/download_model`,
    /** POST - Delete a model (body: CompositeArtifactId) */
    deleteModel: `${API_PREFIX}/artifacts/delete_model`,
  },

  /**
   * Job monitoring and execution endpoints
   */
  job: {
    /** POST - Submit a job for execution (by definition id) */
    execute: `${API_PREFIX}/job/execute`,
    /** GET - Get paginated status of all executions */
    status: `${API_PREFIX}/job/status`,
    /** GET - Get status of a single execution */
    statusById: (executionId: string) =>
      `${API_PREFIX}/job/${executionId}/status`,
    /** GET - Get job outputs (product-to-task mapping) */
    outputs: (executionId: string) =>
      `${API_PREFIX}/job/${executionId}/outputs`,
    /** GET - Get list of available output task IDs */
    available: (executionId: string) =>
      `${API_PREFIX}/job/${executionId}/available`,
    /** GET - Get job result data by task ID */
    results: (executionId: string) =>
      `${API_PREFIX}/job/${executionId}/results`,
    /** GET - Download job logs as ZIP */
    logs: (executionId: string) => `${API_PREFIX}/job/${executionId}/logs`,
    /** POST - Restart an execution (returns same execution_id with bumped attempt_count) */
    restart: (executionId: string) =>
      `${API_PREFIX}/job/${executionId}/restart`,
    /** DELETE - Delete an execution (execution_id as query param) */
    delete: `${API_PREFIX}/job/delete`,
  },

  /**
   * Gateway endpoints
   */
  gateway: {
    /** GET - Get gateway status */
    status: `${API_PREFIX}/gateway/status`,
    /** GET - Stream gateway logs (SSE) */
    logs: `${API_PREFIX}/gateway/logs`,
  },

  /**
   * Schedule management endpoints
   */
  schedule: {
    /** GET - List all schedules (query: page, page_size, enabled) */
    list: `${API_PREFIX}/schedule/list`,
    /** PUT - Create a new schedule */
    create: `${API_PREFIX}/schedule/create`,
    /** GET - Get a schedule (query: experiment_id) */
    get: `${API_PREFIX}/schedule/get`,
    /** POST - Update a schedule (query: experiment_id) */
    update: `${API_PREFIX}/schedule/update`,
    /** POST - Delete a schedule (query: experiment_id) */
    delete: `${API_PREFIX}/schedule/delete`,
    /** GET - Get next run time (query: experiment_id) */
    nextRun: `${API_PREFIX}/schedule/next_run`,
    /** GET - Get runs for a schedule (query: experiment_id, page, page_size, status) */
    runs: `${API_PREFIX}/schedule/runs`,
    /** POST - Restart the scheduler thread */
    restart: `${API_PREFIX}/schedule/restart`,
    /** GET - Get the scheduler's current time */
    currentTime: `${API_PREFIX}/schedule/current_time`,
  },
} as const

/**
 * Path patterns for MSW mock handlers
 *
 * These use `:param` syntax for dynamic route matching.
 * Only needed for endpoints with path parameters.
 *
 * Usage in mock handlers:
 * ```typescript
 * import { API_PATTERNS } from '@/api/endpoints'
 *
 * http.get(API_PATTERNS.job.statusById, async ({ params }) => {
 *   const { jobId } = params
 *   // ...
 * })
 * ```
 */
export const API_PATTERNS = {
  /**
   * Artifacts patterns - all use static paths (IDs in request body)
   */
  artifacts: {
    listModels: `${API_PREFIX}/artifacts/list_models`,
    modelDetails: `${API_PREFIX}/artifacts/model_details`,
    downloadModel: `${API_PREFIX}/artifacts/download_model`,
    deleteModel: `${API_PREFIX}/artifacts/delete_model`,
  },
  /**
   * Plugin patterns - all use static paths now (no path params)
   * Plugin ID is sent in request body, not URL.
   */
  plugin: {
    status: `${API_PREFIX}/plugin/status`,
    details: `${API_PREFIX}/plugin/details`,
    install: `${API_PREFIX}/plugin/install`,
    uninstall: `${API_PREFIX}/plugin/uninstall`,
    update: `${API_PREFIX}/plugin/update`,
    modifyEnabled: `${API_PREFIX}/plugin/modifyEnabled`,
  },
  job: {
    /** Pattern: /api/v1/job/:executionId/status */
    statusById: `${API_PREFIX}/job/:executionId/status`,
    /** Pattern: /api/v1/job/:executionId/outputs */
    outputs: `${API_PREFIX}/job/:executionId/outputs`,
    /** Pattern: /api/v1/job/:executionId/available */
    available: `${API_PREFIX}/job/:executionId/available`,
    /** Pattern: /api/v1/job/:executionId/results */
    results: `${API_PREFIX}/job/:executionId/results`,
    /** Pattern: /api/v1/job/:executionId/logs */
    logs: `${API_PREFIX}/job/:executionId/logs`,
    /** Pattern: /api/v1/job/:executionId/restart */
    restart: `${API_PREFIX}/job/:executionId/restart`,
    /** Pattern: /api/v1/job/delete (execution_id as query param) */
    delete: `${API_PREFIX}/job/delete`,
  },
} as const
