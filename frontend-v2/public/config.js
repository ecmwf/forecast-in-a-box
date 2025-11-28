/*
 * (C) Copyright 2025- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * RUNTIME CONFIGURATION (PRIMARY SOURCE)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ✅ This is the PRIMARY configuration source for the application
 * ✅ Values here OVERRIDE build-time .env settings
 * ✅ Changes take effect WITHOUT rebuilding the application
 * ✅ Perfect for Docker/Kubernetes deployments
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * How to use in different environments:
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * LOCAL DEVELOPMENT:
 *   Just edit this file and refresh your browser - no rebuild needed!
 *
 * DOCKER:
 *   Mount a custom config file as a volume:
 *     docker run -v /path/to/custom-config.js:/app/dist/config.js my-app
 *
 *   Or use environment variable substitution with config.template.js:
 *     CMD envsubst < config.template.js > config.js && nginx
 *     docker run -e API_BASE_URL=https://api.prod.com my-app
 *
 * KUBERNETES:
 *   Use a ConfigMap to provide this file:
 *     kubectl create configmap fiab-config --from-file=config.js
 *     # Then mount it in your Pod spec
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * See RUNTIME_CONFIG.md for complete documentation and examples
 * ═══════════════════════════════════════════════════════════════════════════════
 */

window.ENV_CONFIG = {
  /**
   * API Base URL (REQUIRED for standalone deployment, null for bundled mode)
   *
   * - Set to a full URL (e.g., 'http://127.0.0.1:8000') for standalone frontend
   * - Set to null when bundled with FastAPI backend (uses relative URLs)
   *
   * When null, all API requests will be made relative to the current origin,
   * allowing the frontend to connect to the FastAPI backend serving it.
   *
   * Examples:
   *   - Standalone: 'http://127.0.0.1:8000' or 'https://api.example.com'
   *   - Bundled with FastAPI: null
   */
  API_BASE_URL: null,

  /**
   * Environment Name (OPTIONAL)
   * Used for debugging and display purposes
   * Examples: 'development', 'staging', 'production'
   */
  ENVIRONMENT: 'production',

  /**
   * Enable Debug Mode (OPTIONAL)
   * Shows additional debug information in the browser console
   * Set to true to see configuration details and API calls
   */
  DEBUG: false,
}
