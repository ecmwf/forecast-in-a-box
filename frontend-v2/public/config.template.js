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
 * Runtime Configuration Template for Docker/Kubernetes
 *
 * This template file uses environment variable placeholders that can be substituted
 * at container startup using envsubst or similar tools.
 *
 * Usage with envsubst:
 *   envsubst < config.template.js > config.js
 *
 * Docker example:
 *   CMD envsubst < /app/dist/config.template.js > /app/dist/config.js && nginx -g 'daemon off;'
 *
 * Kubernetes ConfigMap example:
 *   apiVersion: v1
 *   kind: ConfigMap
 *   metadata:
 *     name: fiab-frontend-config
 *   data:
 *     config.js: |
 *       window.ENV_CONFIG = {
 *         API_BASE_URL: 'https://api.production.example.com',
 *         ENVIRONMENT: 'production',
 *         DEBUG: false,
 *       }
 */

window.ENV_CONFIG = {
  API_BASE_URL: '${API_BASE_URL:-null}',
  ENVIRONMENT: '${ENVIRONMENT:-production}',
  DEBUG: ${DEBUG:-false},
}
