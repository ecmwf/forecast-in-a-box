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
 * Every path is a static string; dynamic values travel as query params or
 * request bodies, never as path segments.
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
 * All API endpoint paths for production code.
 *
 * Every path is a static string; dynamic values travel as query params
 * or request bodies, never as path segments.
 *
 * Usage:
 * ```typescript
 * import { API_ENDPOINTS } from '@/api/endpoints'
 *
 * apiClient.get(API_ENDPOINTS.status)
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
    catalogue: `${API_PREFIX}/blueprint/catalogue`,
    /** PUT - Expand a fable configuration */
    expand: `${API_PREFIX}/blueprint/expand`,
    /** GET - Retrieve a saved fable with metadata */
    get: `${API_PREFIX}/blueprint/get`,
    /** POST - Create a fable with metadata (returns { blueprint_id, version }) */
    create: `${API_PREFIX}/blueprint/create`,
    /** POST - Update a fable with metadata */
    update: `${API_PREFIX}/blueprint/update`,
    /** GET - List all fable definitions */
    list: `${API_PREFIX}/blueprint/list`,
    /** POST - Delete a fable definition */
    delete: `${API_PREFIX}/blueprint/delete`,
    /** GET - List glyphs available for ${glyph} interpolation (query: glyph_type intrinsic|global) */
    glyphsList: `${API_PREFIX}/blueprint/glyphs/list`,
    /** GET - List custom Jinja filters/globals available in glyph expressions */
    glyphsFunctions: `${API_PREFIX}/blueprint/glyphs/functions`,
    /** POST - Create or update a global glyph */
    glyphsGlobalPost: `${API_PREFIX}/blueprint/glyphs/global/post`,
    /** POST - Delete a global glyph by ID */
    glyphsGlobalDelete: `${API_PREFIX}/blueprint/glyphs/global/delete`,
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
    /** POST - Submit a job for execution (by blueprint id) */
    create: `${API_PREFIX}/run/create`,
    /** GET - Get paginated status of all executions */
    list: `${API_PREFIX}/run/list`,
    /** GET - Get status of a single execution (query: run_id) */
    get: `${API_PREFIX}/run/get`,
    /** GET - Get task-level compilation detail (query: run_id, block_id?) */
    compilationDetail: `${API_PREFIX}/run/getCompilationDetail`,
    /** POST - Restart an execution (body: { run_id, attempt_count }) */
    restart: `${API_PREFIX}/run/restart`,
    /** GET - Get a single output's content (query: run_id, dataset_id) */
    outputContent: `${API_PREFIX}/run/outputContent`,
    /** GET - Download job logs as ZIP (query: run_id) */
    logs: `${API_PREFIX}/run/logs`,
    /** POST - Delete an execution (body: { run_id, attempt_count }) */
    delete: `${API_PREFIX}/run/delete`,
  },

  /**
   * Gateway endpoints
   */
  gateway: {
    /** GET - Stream gateway logs (SSE) */
    logs: `${API_PREFIX}/gateway/logs`,
  },

  /**
   * Lens (inspection-tool launcher) endpoints. Lenses run on dynamic ports
   * and are addressed via a server-side instance id.
   */
  lens: {
    /** POST - Start a SkinnyWMS lens (query: local_path) */
    startSkinnyWms: `${API_PREFIX}/lens/start/skinnyWMS`,
    /** GET - Get lens instance status (query: lens_instance_id) */
    status: `${API_PREFIX}/lens/status`,
    /** DELETE - Stop and remove an instance (query: lens_instance_id) */
    stop: `${API_PREFIX}/lens/stop`,
    /** GET - List all active lens instances */
    list: `${API_PREFIX}/lens/list`,
    /** GET - List supported lens types */
    supported: `${API_PREFIX}/lens/supported`,
  },

  /**
   * Schedule management endpoints
   */
  schedule: {
    /** GET - List all schedules (query: page, page_size, enabled) */
    list: `${API_PREFIX}/experiment/list`,
    /** PUT - Create a new schedule */
    create: `${API_PREFIX}/experiment/create`,
    /** GET - Get a schedule (query: experiment_id) */
    get: `${API_PREFIX}/experiment/get`,
    /** POST - Update a schedule (body: experiment_id, version, ...update) */
    update: `${API_PREFIX}/experiment/update`,
    /** POST - Delete a schedule (body: experiment_id, version) */
    delete: `${API_PREFIX}/experiment/delete`,
    /** GET - Get runs for a schedule (query: experiment_id, page, page_size, status) */
    runs: `${API_PREFIX}/experiment/runs/list`,
    /** GET - Get next run time (query: experiment_id) */
    nextRun: `${API_PREFIX}/experiment/runs/next`,
    /** GET - Get the scheduler's current time */
    currentTime: `${API_PREFIX}/experiment/operational/scheduler/current_time`,
  },
} as const
